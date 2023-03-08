'use strict';

var koishi = require('koishi');
var fs = require('fs');
var path = require('path');

/* eslint-disable */
const name = 'logger';
const Config = koishi.Schema.object({
    levels: koishi.Schema.any().description('默认的日志输出等级。'),
    showDiff: koishi.Schema.boolean().description('标注相邻两次日志输出的时间差。'),
    showTime: koishi.Schema.union([Boolean, String])
        .default(true)
        .description('输出日志所使用的时间格式。'),
})
    .description('日志设置')
    .hidden();
koishi.defineProperty(koishi.Context.Config, 'logger', Config);
koishi.Context.Config.list.push(koishi.Schema.object({
    logger: Config,
}));
const prologue = [];
const target = {
    colors: 3,
    showTime: 'yyyy-MM-dd hh:mm:ss',
    print: (text) => prologue.push(text),
};
function prepare(config = {}) {
    const { levels } = config;
    // configurate logger levels
    if (typeof levels === 'object') {
        koishi.Logger.levels = levels;
    }
    else if (typeof levels === 'number') {
        koishi.Logger.levels.base = levels;
    }
    let showTime = config.showTime;
    if (showTime === true)
        showTime = 'yyyy-MM-dd hh:mm:ss';
    if (showTime)
        koishi.Logger.targets[0].showTime = showTime;
    koishi.Logger.targets[0].showDiff = config.showDiff;
    // cli options have higher precedence
    if (process.env.KOISHI_LOG_LEVEL) {
        koishi.Logger.levels.base = +process.env.KOISHI_LOG_LEVEL;
    }
    function ensureBaseLevel(config, base) {
        config.base ??= base;
        Object.values(config).forEach((value) => {
            if (typeof value !== 'object')
                return;
            ensureBaseLevel(value, config.base);
        });
    }
    ensureBaseLevel(koishi.Logger.levels, 2);
    if (process.env.KOISHI_DEBUG) {
        for (const name of process.env.KOISHI_DEBUG.split(',')) {
            new koishi.Logger(name).level = koishi.Logger.DEBUG;
        }
    }
    koishi.Logger.targets.push(target);
    new koishi.Logger('app').info('%C', `Koishi/${koishi.version}`);
    koishi.Logger.timestamp = Date.now();
}
function apply(app) {
    app.prologue = prologue;
    app.on('ready', () => {
        koishi.remove(koishi.Logger.targets, target);
    });
}

var cliLogger = /*#__PURE__*/Object.freeze({
    __proto__: null,
    Config: Config,
    apply: apply,
    name: name,
    prepare: prepare
});

var version = "0.1.0";
var description = "A Koishi.js Launcher for LLSE";

const pluginName = 'LLSEKoishi';
const pluginVersion = version.split('.').map((v) => Number(v));
const pluginDescription = description;
const pluginExtra = {
    Author: 'student_2333',
    License: 'Apache-2.0',
};
const dataPath = path.join('./plugins', pluginName);
const koishiConfigPath = path.join(dataPath, 'koishi.yml');
const dotEnvPath = path.join(dataPath, '.env');
const pluginPath = path.join(dataPath, 'plugins');
const resourceDir = path.join(__dirname, 'res');
const pluginFolderJsonPath = path.join(pluginPath, 'package.json');
if (!fs.existsSync(dataPath))
    fs.mkdirSync(dataPath);
if (!fs.existsSync(pluginPath))
    fs.mkdirSync(pluginPath);
if (!fs.existsSync(koishiConfigPath))
    fs.copyFileSync(path.join(resourceDir, 'koishi.yml'), koishiConfigPath);
if (!fs.existsSync(dotEnvPath))
    fs.writeFileSync(dotEnvPath, '', { encoding: 'utf-8' });
if (!fs.existsSync(pluginFolderJsonPath))
    fs.copyFileSync(path.join(resourceDir, 'package.json'), pluginFolderJsonPath);
logger.setTitle(pluginName);

// eslint-disable-next-line import/no-unresolved
const NpmClass = require('../../lib/node_modules/npm/lib/npm.js');
async function installDeps() {
    const modulesPath = path.join(pluginPath, 'node_modules');
    const npm = new NpmClass();
    await npm.load();
    for (const dir of fs.readdirSync(pluginPath, { withFileTypes: true })) {
        if (dir.isDirectory()) {
            const { name } = dir;
            const path$1 = path.join(pluginPath, name);
            const jsonPath = path.join(path$1, 'package.json');
            if (fs.existsSync(jsonPath)) {
                let packageJson;
                try {
                    packageJson = JSON.parse(fs.readFileSync(jsonPath, { encoding: 'utf-8' }));
                }
                catch (e) {
                    logger.error(`尝试解析 Koishi 插件 ${name} 的 package.json 失败：${e}`);
                    continue;
                }
                const { dependencies } = packageJson;
                if (!dependencies)
                    continue;
                let needInstall = false;
                for (const pkg of Object.keys(dependencies)) {
                    if (!fs.existsSync(path.join(modulesPath, pkg))) {
                        needInstall = true;
                        break;
                    }
                }
                if (needInstall) {
                    logger.info(`为 Koishi 插件 ${name} 安装依赖……`);
                    let res;
                    try {
                        npm.localPrefix = pluginPath;
                        // eslint-disable-next-line no-await-in-loop
                        await npm.exec('install', []);
                    }
                    catch (e) {
                        npm.output('');
                        res = e;
                    }
                    if (res)
                        logger.error(`为 Koishi 插件 ${name} 安装依赖失败\n${res.stack}`);
                    else
                        logger.info(`为 Koishi 插件 ${name} 安装依赖成功`);
                }
            }
        }
    }
}

/* eslint-disable @typescript-eslint/ban-ts-comment */
// 不这样写会出bug
const Loader = require('@koishijs/loader').default;
const loader = new Loader(koishiConfigPath);
const config = loader.readConfig();
prepare(config.logger);
if (config.timezoneOffset !== undefined)
    koishi.Time.setTimezoneOffset(config.timezoneOffset);
if (config.stackTraceLimit !== undefined)
    Error.stackTraceLimit = config.stackTraceLimit;
let app;
function handleException(error) {
    new koishi.Logger('app').error(`Koishi 异常退出！${error.stack || error}`);
}
// process.on('uncaughtException', handleException);
process.on('unhandledRejection', (error) => {
    new koishi.Logger('app').warn(error);
});
function restartKoishi() {
    (async () => {
        logger.info('启动 Koishi ……');
        app = await loader.createApp();
        app.plugin(cliLogger);
        await app.start();
    })().catch(handleException);
}
mc.listen('onServerStarted', () => {
    setTimeout(async () => {
        await installDeps().catch(console.log);
        restartKoishi();
    });
});
ll.registerPlugin(pluginName, pluginDescription, pluginVersion, pluginExtra);
