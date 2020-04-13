import * as fse from 'fs-extra';
import * as utils from './utils';

export interface Configs {
  verbose: boolean;
  showStatusBar: boolean;
  pythonLocation: string;
  proxy: string;
  noSSLVerify: boolean;
}

const defaultConfigs: Configs = {
  verbose: false,
  showStatusBar: true,
  pythonLocation: '',
  proxy: '',
  noSSLVerify: false
};

function combineDefaults(configs: Object): Configs {
  return {
    ...defaultConfigs,
    ...configs
  };
}

export async function newConfigs(): Promise<Configs> {
  try {
    const filename = utils.getInvokerConfigsPath();
    let existed = await fse.pathExists(filename);
    if (existed) {
      let configs = readConfigs(filename);
      return configs;
    } else {
      await fse.outputJSON(filename, defaultConfigs);
      return defaultConfigs;
    }
  } catch (err) {
    throw err;
  }
}

export async function saveConfigs(configs: Configs): Promise<void> {
  try {
    const filename = utils.getInvokerConfigsPath();
    fse.outputJSON(filename, configs);
  } catch (err) {
    throw err;
  }
}

async function readConfigs(filename: string): Promise<Configs> {
  try {
    const json = await fse.readJson(filename);
    return combineDefaults(json);
  } catch (err) {
    throw err;
  }
}
