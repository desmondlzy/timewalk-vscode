import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import * as adm_zip from 'adm-zip';
import * as request from 'request';
import * as fse from 'fs-extra';

import { Configs, saveConfigs } from './configs';
import { Logger } from './logger';

export class Dependencies {
  private cachedPythonLocation: string;
  private configs: Configs;
  private logger: Logger;
  private extensionPath: string;

  constructor(configs: Configs, extensionPath: string, logger: Logger) {
    this.configs = configs;
    this.logger = logger;
    this.extensionPath = extensionPath;
    this.cachedPythonLocation = configs.pythonLocation;
    logger.debug("Dependencies module initialized");
  }

  public async checkAndInstall(): Promise<void> {
    let pythonInstalled : boolean = await this.isPythonInstalled();
    if (!pythonInstalled) {
      this.logger.debug('No valid version of python exists');
      await this.installPython();
    } else {
      this.logger.debug('Valid version of python installed');
    }
    await this.checkAndInstallCore();
    return;
  }

  public async checkAndInstallCore(): Promise<void> {
    if (!this.isCoreInstalled()) {
      this.logger.info("timewalk-core not installed");
      await this.installCore();
    } else {
      let isLatest : boolean = await this.isCoreLatest();
      if (!isLatest) {
        this.logger.info("Core program not up-to-date");
        await this.installCore();
      } 
    }
  }

  public async getPythonLocation(): Promise<string | null> {
    return new Promise<string | null>(async (resolve, reject) => {
      if (this.cachedPythonLocation !== '') { 
        this.logger.debug(`Using cached python location ${this.cachedPythonLocation}`);
        resolve(this.cachedPythonLocation); 
      } else {
        let locations: string[] = [
          path.join(this.extensionPath, 'python', 'pythonw'),
          'python3',
          'pythonw',
          'python',
          '/usr/local/bin/python3',
          '/usr/local/bin/python',
          '/usr/bin/python3',
          '/usr/bin/python',
        ];

        for (var i = 39; i >= 35; i--) {
          locations.push(`\\python${i}\\pythonw`);
          locations.push(`\\Python${i}\\pythonw`);
        }

        let python = await this.findPython(locations);
        if (python !== null) {
          this.configs.pythonLocation = python;
          this.cachedPythonLocation = python;
          try {
            saveConfigs(this.configs);
          } catch (error) {
            this.logger.warn(error);
          }
        }
        resolve(python);
      }
    });

  }

  public getCoreLocation(): string {
    let dir = path.join(this.extensionPath, 'timewalk-core-master', 'timewalk', 'cli.py');
    return dir;
  }

  public static isWindows(): boolean {
    return os.type() === 'Windows_NT';
  }

  private async findPython(locations: string[]): Promise<string | null> {
    return new Promise<string | null>(async (resolve, reject) => {
      const binary = locations.shift();
      if (binary === undefined) {
        resolve(null);
        return;
      }

      this.logger.debug(`Looking for python at: ${binary}`);

      const args = ['--version'];
      try {
        if (binary !== undefined) {
          child_process.execFile(binary, args, async (error, stdout, stderr) => {
            const output: string = stdout.toString() + stderr.toString();
            if (!error && this.isSupportedPythonVersion(binary, output)) {
              this.cachedPythonLocation = binary;
              this.logger.debug(`Valid python binary ${binary}, version: ${output}`);
              resolve(binary);
            } else {
              this.logger.debug(`Invalid python version: ${output}`);
              resolve(await this.findPython(locations));
            }
          });
        }
      } catch (e) {
        this.logger.debug(e);
        resolve(await this.findPython(locations));
      }
    });

  }

  private isCoreInstalled(): boolean {
    return fse.existsSync(this.getCoreLocation());
  }

  private async isCoreLatest(): Promise<boolean> {
    return new Promise<boolean>(async (resolve, _reject) => {
      let pythonBinary : string | null = await this.getPythonLocation();
      if (pythonBinary) {
        let args = [this.getCoreLocation(), '--version'];
        child_process.execFile(pythonBinary, args, async (error, stdout, _stderr) => {
          if (!(error !== null)) {
            let currentVersion = stdout.toString().trim();
            this.logger.debug(`Current timewalk-core version is ${currentVersion}`);

            this.logger.debug('Checking for updates to timewalk-core...');
            let latestVersion = await this.getLatestCoreVersion();
            if (currentVersion === latestVersion) {
              this.logger.debug('timewalk-core is up to date');
              resolve(true);
            } else if (latestVersion) {
              this.logger.debug(`Found an updated timewalk-core v${latestVersion}`);
              resolve(false);
            } else {
              this.logger.debug('Unable to find latest timewalk-core version from GitHub');
              resolve(false);
            }
          } else {
            resolve(false);
          }
        });
      } else {
        resolve(false);
      }
    });
  }

  private async getLatestCoreVersion(): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      let url: string = 'https://raw.githubusercontent.com/desmondlzy/timewalk-core/master/timewalk/__about__.py';
      let reqOptions = await this.getRequestOptionsForUrl(url);
      request.get(reqOptions, (error: any, response: any, body: any) => {
        let version: string = '';
        if (!error && response.statusCode === 200) {
          let lines = body.split('\n');
          for (var i = 0; i < lines.length; i++) {
            let re = /^__version_info__ = \('([0-9]+)', '([0-9]+)', '([0-9]+)'\)/g;
            let match = re.exec(lines[i]);
            if (match) {
              version = match[1] + '.' + match[2] + '.' + match[3];
              resolve(version);
              return;
            }
          }
        }
        resolve(version);
      });
    });
  }

  private async getRequestOptionsForUrl(url: string): Promise<request.OptionsWithUrl> {
    let reqOptions : request.OptionsWithUrl = { url: url };
    if (this.configs.proxy) { reqOptions['proxy'] = this.configs.proxy; }
    if (this.configs.noSSLVerify) { reqOptions['strictSSL'] = false; }
    return reqOptions;
  }

  private async installCore(): Promise<void> {
    let url = 'https://github.com/desmondlzy/timewalk-core/archive/master.zip';
    let zipFile = path.join(this.extensionPath, 'timewalk-core-master.zip');

    await this.downloadFile(url, zipFile);
    await this.extractCore(zipFile);
  }

  private async extractCore(zipFile: string): Promise<void> {
    this.logger.info(`Extracting timewalk-core into "${this.extensionPath}"...`);
    await this.removeCore();
    await this.unzip(zipFile, this.extensionPath);
    this.logger.info('Finished extracting timewalk-core.');
  }

  private async removeCore(): Promise<void> {
    const target = path.join(this.extensionPath, 'timewalk-core-master');
    try {
      let existing = await fse.pathExists(target);
      if (existing) {
        await fse.remove(target);
      } else {
        this.logger.warn(`"${target}" does not exist, maybe the download failed`);
      }
    } catch (err) {
      this.logger.warn(err);
    }
  }

  private async downloadFile(url: string, outputFile: string): Promise<void> {
    return new Promise<void>(async (resolve, _reject) => {
      this.logger.info(`Downloading ${outputFile} from ${url}...`);
      let options = await this.getRequestOptionsForUrl(url);
      let r = request.get(options);
      let out = fse.createWriteStream(outputFile);
      r.on('error', (err) => {
        this.logger.error(err.message);
      });
      r.pipe(out);
      r.on('end', () => {
        out.on('finish', () => {
          this.logger.info("download finished");
          resolve();
        });
      });
    });
  }

  private async unzip(file: string, outputDir: string): Promise<void> {
    let exists = await fse.pathExists(file);
    if (exists) {
      try {
        let zip = new adm_zip(file);
        zip.extractAllTo(outputDir, true);
      } catch (err) {
        this.logger.error(err);
      } finally {
        try {
          await fse.remove(file);
        } catch (err2) {
          this.logger.warn(err2);
        }
      }
    }
  }

  private async isPythonInstalled(): Promise<boolean> {
    let binary = await this.getPythonLocation();
    return binary !== null;
  }

  private async installPython(): Promise<void> {
    if (Dependencies.isWindows()) {
      let ver = '3.8.1';
      let arch = (os.arch().indexOf('x64') > -1) ? 'amd64' : 'win32';
      let url = `https://www.python.org/ftp/python/${ver}/python-${ver}-embed-${arch}.zip`;

      this.logger.debug('Downloading python...');
      let zipFile = path.join(this.extensionPath, 'python.zip');
      this.downloadFile(url, zipFile);

      this.logger.debug('Extracting python...');
      await this.unzip(zipFile, path.join(this.extensionPath, 'python'));
      this.logger.debug('Finished installing python.');
    } else {
      let errMsg =
        'TimeWalk requires Python 3.5+. Install it from https://python.org/downloads then restart VS Code';
      this.logger.warn(errMsg);
      vscode.window.showWarningMessage(errMsg);
    }
  }

  private isSupportedPythonVersion(binary: string, versionString: string): boolean {
    const anaconda = /continuum|anaconda/gi;
    const isAnaconda: boolean = !!anaconda.test(versionString);
    const re = /python\s+(\d+)\.(\d+)\.(\d+)\s/gi;
    const ver = re.exec(versionString);
    if (!ver) { return !isAnaconda; }

    return parseInt(ver[1]) === 3 && parseInt(ver[2]) >= 5;
  }
}
