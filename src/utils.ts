import * as fse from 'fs-extra';
import * as path from 'path';
import { Dependencies } from './dependencies';
import {
  DIRNAME_HOME, FILENAME_CONFIG, FILENAME_INVOKER_CONFIG, FILENAME_LOG
} from './constants';

export function quote(str: string): string {
  if (str.includes(' ')) { return `"${str.replace('"', '\\"')}"`; }
  return str;
}

export function getTimewalkHome(): string {
  return path.join(getUserHomeDir(), DIRNAME_HOME);
}

export function getInvokerConfigsPath(): string {
  return path.join(getTimewalkHome(), FILENAME_INVOKER_CONFIG);
}

export function getCoreConfigFile(): string {
  const configFile = path.join(getUserHomeDir(), FILENAME_CONFIG);
  if (!fse.existsSync(configFile)) {
    fse.openSync(configFile, 'w');
  }
  return configFile;
}

export function getLogFile(): string {
  const logFilePath = path.join(getUserHomeDir(), FILENAME_LOG);
  if (!fse.existsSync(logFilePath)) {
    fse.openSync(logFilePath, 'w');
  }
  return logFilePath;
}

export function getUserHomeDir(): string {
  if (process.env['VSCODE_PORTABLE']) { return process.env['VSCODE_PORTABLE'] as string; }
  return process.env[Dependencies.isWindows() ? 'USERPROFILE' : 'HOME'] || '';
}

export function validateProxy(proxy: string): string {
  const err =
    'Invalid proxy. Valid formats are https://user:pass@host:port or socks5://user:pass@host:port or domain\\user:pass';
  if (!proxy) { return err; }
  let re = new RegExp('^((https?|socks5)://)?([^:@]+(:([^:@])+)?@)?[\\w\\.-]+(:\\d+)?$', 'i');
  if (proxy.indexOf('\\') > -1) { re = new RegExp('^.*\\\\.+$', 'i'); }
  if (!re.test(proxy)) { return err; }
  return '';
}

export function formatDate(date: Date): string {
  let months = [
    'Jan', 'Feb', 'Mar', 'Apr',
    'May', 'Jun', 'Jul', 'Aug',
    'Sep', 'Oct', 'Nov', 'Dec',
  ];
  let ampm = 'AM';
  let hour = date.getHours();
  if (hour > 11) {
    ampm = 'PM';
    hour = hour - 12;
  }
  if (hour === 0) {
    hour = 12;
  }
  let minute = date.getMinutes();
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${hour}:${
    minute < 10 ? `0${minute}` : minute
  } ${ampm}`;
}