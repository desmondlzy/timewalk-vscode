import * as vscode from 'vscode';
import * as child_process from 'child_process';

import { Dependencies } from './dependencies';
import { COMMAND_REPORT_PAGE, LogLevel } from './constants';
import { Configs, saveConfigs } from './configs';
import { Logger, logger } from './logger';
import * as utils from './utils';

export class TimeWalk {
  private appNames = {
    // 'SQL Operations Studio': 'sqlops',
    'Visual Studio Code': 'vscode',
  };
  private agentName: string | undefined;
  private extension: any | undefined;
  private statusBar: vscode.StatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
  );
  private disposable: vscode.Disposable | undefined;
  private lastFile: string | undefined;
  private lastHeartbeat: number = 0;
  private extensionPath: string;
  private dependencies: Dependencies;
  private configs: Configs;
  private logger: Logger;
  private getCodingActivityTimeout: NodeJS.Timer | undefined;
  private lastFetchToday: number = 0;

  private showStatusBar: boolean | undefined = true;
  private showCodingActivity: boolean = true;

  constructor(extensionPath: string, logger: Logger, configs: Configs) {
    this.extensionPath = extensionPath;
    this.logger = logger;
    this.configs = configs;
    this.statusBar.command = COMMAND_REPORT_PAGE;
    this.dependencies = new Dependencies(this.configs, this.extensionPath, this.logger);
  }

  public async initialize(): Promise<void> {
      let extension = vscode.extensions.getExtension('desmondlzy.timewalk-vscode');
      this.extension = (extension !== undefined && extension.packageJSON) || { version: '0.0.1' };
      this.logger.debug(`Initializing TimeWalk v${this.extension && this.extension.version}`);
      this.agentName = 'vscode';
      this.statusBar.text = '$(clock) TimeWalk Initializing...';
      this.statusBar.show();

      await this.dependencies.checkAndInstall();

      this.logger.debug('Initialized');
      this.statusBar.text = '$(clock)';
      this.statusBar.tooltip = 'TimeWalk: Initialized';
      this.statusBar.show();

      this.getCodingActivity();
      this.setupEventListeners();
  }

  public async promptForDebug(): Promise<void> {
    try {
      let promptOptions = {
        placeHolder: `true or false (current value \"${this.configs.verbose}\")`,
        value: this.configs.verbose,
        ignoreFocusOut: true,
      };
      let items: string[] = ['true', 'false'];
      let newVal = await vscode.window.showQuickPick(items, promptOptions);
      if (newVal === null || newVal === undefined) { return; }

      this.configs.verbose = newVal === 'true';
      this.safeSaveConfigs();

      if (this.configs.verbose) {
        this.logger.setLevel(LogLevel.DEBUG);
        this.logger.debug('Debug enabled');
      } else {
        this.logger.setLevel(LogLevel.INFO);
      }
    } catch (e) {
      this.logger.warn(e);
    }
  }

  public async promptStatusBarIcon(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      let items: string[] = ['true', 'false'];
      let promptOptions = {
        placeHolder: `true or false (current value \"${this.configs.showStatusBar}\")`,
        value: this.configs.showStatusBar,
        ignoreFocusOut: true,
      };
      let pick = await vscode.window.showQuickPick(items, promptOptions);
      if (pick === null || pick === undefined) { return; }

      this.configs.showStatusBar = pick === 'true';
      this.showStatusBar = this.configs.showStatusBar;
      this.safeSaveConfigs();

      if (this.configs.showStatusBar) {
        this.statusBar.show();
        this.logger.debug('Status bar enabled');
      } else {
        this.statusBar.hide();
        this.logger.debug('Status bar disabled');
      }
    });
  }

  public async getReport(start?: number, end?: number): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      let pythonBinary = await this.dependencies.getPythonLocation();
      if (pythonBinary === null) { resolve(); return; }

      let core = this.dependencies.getCoreLocation();
      
      const startStr = Math.round(start || 0).toString();
      const endStr   = Math.round(end   || Date.now() / 1000).toString();
      let args: string[] = [core, 'report', '--start-time', startStr, '--end-time', endStr];

      this.logger.debug(`Gathering report from core, time range ${startStr} - ${endStr}`);

      let process = child_process.execFile(pythonBinary, args, (error, stdout, stderr) => {
        if (error !== null) {
          if (stderr && stderr.toString() !== '') { this.logger.error(stderr.toString()); }
          if (stdout && stdout.toString() !== '') { this.logger.error(stdout.toString()); }
          this.logger.error(error.toString());
        }
      });
      let output = '';
      if (process.stdout) {
        process.stdout.on('data', (data: string | null) => {
          if (data) { output += data; }
        });
      }
      process.on('close', (code, _signal) => {
        if (code === 0) {
          if (output) {
            resolve(output);
            return;
          }
        } else {
          let error_msg = `Error gathering report (${code}); Check your ${utils.getCoreConfigFile()} file for more details`;
          this.logger.debug(error_msg);
          vscode.window.showErrorMessage(error_msg);
          reject(error_msg);
        }
      });
    });
  }
  
  public async promptReportTimeRange(): Promise<number> {
    let opt = {
      placeHolder: 'Please select the range of your coding report',
      canPickMany: false,
      ignoreFocusOut: true
    };
    let items = ['today', '3-day', '5-day', '7-day', '14-day'];
    let choice = await vscode.window.showQuickPick(items, opt);

    let startOfToday = new Date().setHours(0, 0, 0, 0) / 1000;
    let oneDay = 24 * 60 * 60;
    switch (choice) {
      case 'today': return startOfToday;
      case '3-day': return startOfToday - oneDay * 3;
      case '5-day': return startOfToday - oneDay * 5;
      case '7-day': return startOfToday - oneDay * 7;
      case '14-day': return startOfToday - oneDay * 14;
      default: return startOfToday;
    }
  }

  public async openReportPage(): Promise<void> {
    let reqTime = Date.now();
    let uri = vscode.Uri.parse(`timewalk:report_today_${reqTime}.md`);
    this.logger.debug(`Trying to open a virtual text document for report`);

    let doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('markdown.showPreview');
    return;
  }

  public openCoreConfigFile(): void {
    let path = utils.getCoreConfigFile();
    if (path) {
      let uri = vscode.Uri.file(path);
      vscode.window.showTextDocument(uri).then(doc => {
        doc.viewColumn = vscode.ViewColumn.Beside;
      });
    }
  }

  public openInvokerConfigFile(): void {
    let path = utils.getInvokerConfigFile();
    if (path) {
      let uri = vscode.Uri.file(path);
      vscode.window.showTextDocument(uri).then(doc => {
        doc.viewColumn = vscode.ViewColumn.Beside;
      });
    }
  }

  public openLogFile(): void {
    let path = utils.getLogFile();
    if (path) {
      let uri = vscode.Uri.file(path);
      vscode.window.showTextDocument(uri).then(doc => {
        doc.viewColumn = vscode.ViewColumn.Beside;
      });
    }
  }

  public dispose() {
    this.statusBar.dispose();
    if (this.disposable) {
      this.disposable.dispose();
      if (this.getCodingActivityTimeout) {
        clearTimeout(this.getCodingActivityTimeout);
      }
    }
  }

  private setupEventListeners(): void {
    // subscribe to selection change and editor activation events
    let subscriptions: vscode.Disposable[] = [];
    vscode.window.onDidChangeTextEditorSelection(this.onChange, this, subscriptions);
    vscode.window.onDidChangeActiveTextEditor(this.onChange, this, subscriptions);
    vscode.workspace.onDidSaveTextDocument(this.onSave, this, subscriptions);
    // create a combined disposable from both event subscriptions
    this.disposable = vscode.Disposable.from(...subscriptions);
  }

  private onChange(): void {
    this.onEvent(false);
  }

  private onSave(): void {
    this.onEvent(true);
  }

  private onEvent(isWrite: boolean): void {
    let editor = vscode.window.activeTextEditor;
    let file = vscode.window.activeTextEditor?.document?.fileName;
    if (file) {
      let time: number = Date.now();
      if (isWrite || this.enoughTimePassed(time) || this.lastFile !== file) {
        this.invokeCore(file, isWrite);
        this.lastFile = file;
        this.lastHeartbeat = time;
      }
    }
  }

  private invokeCore(file: string, isWrite: boolean): void {
    this.dependencies.getPythonLocation().then(pythonBinary => {
        if (pythonBinary) {
        let core = this.dependencies.getCoreLocation();
        let user_agent = `${this.agentName}/${vscode.version} timewalk-vscode/${this.extension.version}`;
        let args = [core, 'record', '--file', utils.quote(file), '--invoker', utils.quote(user_agent)];
        let project = this.getProjectName(file);
        if (project) { args.push('--project', utils.quote(project)); }
        if (isWrite) { args.push('--write'); }

        this.logger.debug(`Invoking core: ${this.formatArguments(pythonBinary, args)}`);

        let process = child_process.execFile(pythonBinary, args, (error, stdout, stderr) => {
            if (error !== null) {
              if (stderr && stderr.toString() !== '') { this.logger.error(stderr.toString()); }
              if (stdout && stdout.toString() !== '') { this.logger.error(stdout.toString()); }
            this.logger.error(error.toString());
          }
        });
        process.on('close', (code, _signal) => {
          if (code === 0) {
            if (this.showStatusBar) {
              if (!this.showCodingActivity) { this.statusBar.text = '$(clock)'; }
              this.getCodingActivity();
            }
            let today = new Date();
            this.logger.debug(`last invocation of core, ${utils.formatDate(today)}`);
          }
        });
      }
    });
  }

  private getCodingActivity(force: boolean = false) {
    if (!this.showCodingActivity || !this.showStatusBar) { return; }
    
    let fetchTodayInterval = 120 * 1e3;
    const cutoff = Date.now() - fetchTodayInterval;
    if (!force && this.lastFetchToday > cutoff) { return; }

    this.lastFetchToday = Date.now();
    this.dependencies.getPythonLocation().then(pythonBinary => {

      if (!pythonBinary) { return; }
      let core = this.dependencies.getCoreLocation();
      let startOfToday = new Date().setHours(0, 0, 0, 0) / 1000;
      let args = [core, 'query', '--start-time', startOfToday.toString()];

      this.logger.debug(`Fetching coding activity for Today from core`);

      let process = child_process.execFile(pythonBinary, args, (error, stdout, stderr) => {
        if (error !== null) {
          if (stderr && stderr.toString() !== '') { this.logger.error(stderr.toString()); }
          if (stdout && stdout.toString() !== '') { this.logger.error(stdout.toString()); }
          this.logger.error(error.toString());
        }
      });
      let output = '';
      if (process.stdout) {
        process.stdout.on('data', (data: string | null) => {
          if (data) { output += data; }
        });
      }
      process.on('close', (code, _signal) => {
        if (code === 0) {
          if (output && this.showStatusBar && this.showCodingActivity) {
            
            let sessions : Array<any> = JSON.parse(output.trim());
            let totalSeconds = sessions.map((e) => e["duration"]).reduce((prev, cur) => prev + cur, 0);
            let totalMinutes = Math.round(totalSeconds / 60);

            this.statusBar.text = `$(clock) ${totalMinutes} min`;
            this.statusBar.tooltip = `TimeWalk: You coded ${totalMinutes} minutes today.`;
          }
        } else {
          let error_msg = `Error fetching today coding activity (${code}); Check your ${utils.getLogFile()} file for more details`;
          this.logger.debug(error_msg);
        }
      });
    });
  }

  public async promptForProxy(): Promise<void> {
    let oldVal = this.configs.proxy;
    let promptOptions = {
      prompt: 'TimeWalk Proxy',
      placeHolder: `Proxy format is https://user:pass@host:port (current value \"${oldVal}\")`,
      value: oldVal,
      ignoreFocusOut: true,
      validateInput: utils.validateProxy.bind(this)
    };
    let newVal = await vscode.window.showInputBox(promptOptions);
    if (newVal && newVal !== oldVal) {
      this.configs.proxy = newVal;
      this.safeSaveConfigs();
    }
  }


  private enoughTimePassed(time: number): boolean {
    return this.lastHeartbeat + 120000 < time;
  }

  private getProjectName(file: string): string {
    let uri = vscode.Uri.file(file);
    let workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (vscode.workspace && workspaceFolder) {
      try {
        return workspaceFolder.name;
      } catch (e) {}
    }
    return '';
  }

  private wrapArg(arg: string): string {
    if (arg.indexOf(' ') > -1) { return '"' + arg.replace(/"/g, '\\"') + '"'; }
    return arg;
  }

  private formatArguments(python: string, args: string[]): string {
    let clone = args.slice(0);
    clone.unshift(this.wrapArg(python));
    let newCmds: string[] = [];
    let lastCmd = '';
    for (let i = 0; i < clone.length; i++) {
      newCmds.push(this.wrapArg(clone[i]));
      lastCmd = clone[i];
    }
    return newCmds.join(' ');
  }

  private async safeSaveConfigs(): Promise<void> {
    try {
      saveConfigs(this.configs);
    } catch (err) {
      this.logger.warn(err);
    }
  }
}
