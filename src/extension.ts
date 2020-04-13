// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
import {
  COMMAND_DEBUG,
  COMMAND_STATUS_BAR_ENABLED,
  COMMAND_STATUS_BAR_CODING_ACTIVITY,
  COMMAND_REPORT_PAGE,
  COMMAND_CONFIG_FILE,
  COMMAND_LOG_FILE,
  LogLevel,
} from './constants';
import { Logger } from './logger';
import { Configs, newConfigs } from './configs';
import { TimeWalk } from './timewalk';

var logger = new Logger(LogLevel.INFO);
var timewalk: TimeWalk;

export async function activate(ctx: vscode.ExtensionContext) {
  logger.info("TimeWalk VSCode starts");

  let configs = await newConfigs();
  timewalk = new TimeWalk(ctx.extensionPath, logger, configs);

  const twScheme = 'timewalk';
  const twProvider = new class implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      return await timewalk.getReport();
    }
  };

  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(twScheme, twProvider)
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_DEBUG, function() {
      timewalk.promptForDebug();
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_STATUS_BAR_ENABLED, function() {
      timewalk.promptStatusBarIcon();
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_REPORT_PAGE, function() {
      timewalk.openReportPage();
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_CONFIG_FILE, function() {
      timewalk.openCoreConfigFile();
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_LOG_FILE, function() {
      timewalk.openLogFile();
    }),
  );

  ctx.subscriptions.push(timewalk);

  let debug = 'true';
  if (debug === 'true') {
    logger.setLevel(LogLevel.DEBUG);
    logger.debug('TIMEWALK DEBUG');
  }
  timewalk.initialize();
}

// this method is called when your extension is deactivated
export function deactivate() {
  timewalk.dispose();
  logger.info('TimeWalk has been disabled!');
}