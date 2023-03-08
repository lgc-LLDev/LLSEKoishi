'use strict';

require('@koishijs/plugin-adapter-onebot');
var kleur = require('kleur');
var koishi = require('koishi');
var mustache = require('mustache');
var os = require('os');
var osUtils = require('os-utils');
var path = require('path');
var types = require('util/types');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var os__namespace = /*#__PURE__*/_interopNamespaceDefault(os);
var path__namespace = /*#__PURE__*/_interopNamespaceDefault(path);

function replaceColorChar(txt) {
    return txt.replace(/§[0123456789abcdefglonmkr]/g, '');
}

// LiteLoaderScript Dev Helper
// 如果不这样用默认导出会出bug 不知道为什么
const checkDiskSpace = require('check-disk-space').default;
class Plugin {
    constructor(ctxOriginal, configOriginal) {
        this.name = 'OneBotBridge';
        this.logger = new koishi.Logger(this.name);
        this.configSchema = koishi.Schema.object({
            superusers: koishi.Schema.array(koishi.Schema.number()).default([]),
            enableGroups: koishi.Schema.array(koishi.Schema.number()).default([]),
            cmdPrefix: koishi.Schema.string().default('/'),
            cmdStatus: koishi.Schema.string().default('查询'),
            pokeStatus: koishi.Schema.boolean().default(true),
            allowCmd: koishi.Schema.array(koishi.Schema.string()).default([]),
            playerChatTemplate: koishi.Schema.string(),
            groupChatTemplate: koishi.Schema.string(),
            playerPreJoinTemplate: koishi.Schema.string(),
            playerJoinTemplate: koishi.Schema.string(),
            playerLeftTemplate: koishi.Schema.string(),
            playerDieTemplate: koishi.Schema.string(),
            serverStatTemplate: koishi.Schema.string(),
            specialAttrPrefix: koishi.Schema.string(),
            specialAttrSuffix: koishi.Schema.string(),
            customRegex: koishi.Schema.array(koishi.Schema.object({
                from: koishi.Schema.array(koishi.Schema.object({
                    type: koishi.Schema.string().required(),
                    regex: koishi.Schema.string().required(),
                    superuser: koishi.Schema.boolean().default(false),
                }).required()).required(),
                actions: koishi.Schema.array(koishi.Schema.object({
                    type: koishi.Schema.string().required(),
                    content: koishi.Schema.string().required(),
                }).required()).required(),
            })),
        });
        this.transformMsgRules = this.warpRules({
            face: '表情',
            video: '视频',
            rps: '猜拳',
            dice: '扔骰子',
            shake: '戳一戳',
            anonymous: '匿名',
            location: '位置',
            music: '音乐',
            poke: '戳一戳',
            forward: '合并转发',
            node: '合并转发',
            xml: 'XML卡片消息',
            json: 'JSON卡片消息',
            cardimage: 'XML卡片消息',
            tts: 'TTS语音',
            share: ({ title }) => `分享：${title}`,
            redbag: ({ title }) => `红包：${title}`,
            record: ({ magic }) => `${magic ? '变声' : ''}语音`,
            contact: ({ type, id }) => `推荐${type === 'qq' ? '好友' : '群'}：${id}`,
            reply: (_, __, session) => this.translateReply(session),
            at: async ({ id }, _, { channelId, onebot }) => {
                const { card, nickname } = (await onebot?.getGroupMemberInfo(Number(channelId), id)) || {};
                return `@${card || nickname || id}`;
            },
            gift: async ({ qq }, _, { channelId, onebot }) => {
                const { card, nickname } = (await onebot?.getGroupMemberInfo(Number(channelId), qq)) || {};
                return `礼物 @${card || nickname || qq}`;
            },
            image: ({ type, subType }) => {
                switch (type) {
                    case 'flash':
                        return '闪照';
                    case 'show':
                        return '秀图';
                    default:
                        return String(subType) === '0' ? '图片' : '动画表情';
                }
            },
        });
        this.config = this.configSchema(configOriginal);
        this.ctx = ctxOriginal
            .platform('onebot')
            .channel(...this.config.enableGroups.map(String));
        // 消息
        this.ctx
            .intersect((s) => s.subtype === 'group')
            .on('message', this.onMessage.bind(this));
        // 戳一戳
        this.ctx
            .intersect((s) => s.targetId === s.bot.selfId)
            .on('notice/poke', this.onPoke.bind(this));
        mc.listen('onChat', this.onMcChat.bind(this));
        mc.listen('onPreJoin', this.onMcPreJoin.bind(this));
        mc.listen('onJoin', this.onMcJoin.bind(this));
        mc.listen('onLeft', this.onMcLeft.bind(this));
        mc.listen('onPlayerDie', this.onMcDie.bind(this));
    }
    warpRules(rules) {
        Object.entries(rules).forEach(([key, func]) => {
            let newFunc;
            if (types.isAsyncFunction(func)) {
                newFunc = async (...args) => this.addHeadAndTail(await func(...args));
            }
            else if (func instanceof Function) {
                newFunc = (...args) => this.addHeadAndTail(func(...args));
            }
            else {
                newFunc = () => this.addHeadAndTail(func);
            }
            rules[key] = newFunc;
        });
        return rules;
    }
    addHeadAndTail(raw) {
        const { specialAttrPrefix, specialAttrSuffix } = this.config;
        return `${specialAttrPrefix}${raw}${specialAttrSuffix}`;
    }
    async translateReply(session) {
        let replyMsg = '';
        const { quote, channelId, onebot } = session;
        const { author, content } = quote || {};
        if (author) {
            const { userId } = author;
            const { card, nickname } = (await onebot?.getGroupMemberInfo(Number(channelId), userId)) || {};
            replyMsg =
                ` @${card || nickname || userId}： ` +
                    `§r${await koishi.h.transformAsync(content || '', this.transformMsgRules, session)}`;
        }
        return `回复${replyMsg}`;
    }
    isRestrictedCmd(cmd) {
        for (const regTxt of this.config.allowCmd)
            if (RegExp(regTxt).test(cmd))
                return true;
        return false;
    }
    broadcastMsg(content, groups = this.config.enableGroups) {
        const { bots } = this.ctx;
        if (bots.length > 0)
            bots[0].broadcast(groups.map(String), content);
    }
    async getStatus() {
        const { serverStatTemplate } = this.config;
        if (serverStatTemplate) {
            const cpuUsage = ((await new Promise((resolve) => {
                osUtils.cpuUsage(resolve);
            })) * 100).toFixed(2);
            const freeMem = os__namespace.freemem();
            const totalMem = os__namespace.totalmem();
            const usedMem = totalMem - freeMem;
            const memory = {
                used: (usedMem / 1024 / 1024).toFixed(2),
                remain: (freeMem / 1024 / 1024).toFixed(2),
                total: (totalMem / 1024 / 1024).toFixed(2),
                percent: ((usedMem / totalMem) * 100).toFixed(2),
            };
            const { free, size, diskPath } = await checkDiskSpace(path__namespace.resolve(__dirname));
            const diskUsed = size - free;
            const disk = {
                diskPath,
                free: (free / 1024 / 1024 / 1024).toFixed(2),
                size: (size / 1024 / 1024 / 1024).toFixed(2),
                used: (diskUsed / 1024 / 1024 / 1024).toFixed(2),
                percent: ((diskUsed / size) * 100).toFixed(2),
            };
            const players = mc
                .getOnlinePlayers()
                .map((pl) => ({ pl, dv: pl.getDevice() }));
            return mustache.render(serverStatTemplate, {
                cpuUsage,
                memory,
                disk,
                bdsVersion: mc.getBDSVersion(),
                protocolVersion: mc.getServerProtocolVersion(),
                llVersion: ll.versionString(),
                plugins: ll.listPlugins(),
                players,
            });
        }
        return null;
    }
    async sendStatus(session) {
        const rendered = await this.getStatus();
        if (rendered) {
            this.logger.info(rendered);
            if (session)
                session.send(rendered);
            else
                this.broadcastMsg(rendered);
        }
    }
    async onMessage(session) {
        const { content } = session;
        const { groupChatTemplate, cmdPrefix, superusers, cmdStatus } = this.config;
        const txtContent = koishi.h
            .select(content, 'text')
            .map((x) => x.attrs.content)
            .join(' ');
        // 执行指令
        if (txtContent.startsWith(cmdPrefix)) {
            const cmd = txtContent.replace(cmdPrefix, ''); // js里只会替换一次
            if (superusers.includes(Number(session.userId)) ||
                this.isRestrictedCmd(cmd)) {
                const res = mc.runcmdEx(cmd);
                const { success } = res;
                const output = replaceColorChar(res.output);
                const successTxt = success ? '成功' : '失败';
                this.logger.info(`执行指令 ${kleur.cyan(cmd)} ` +
                    `${(success ? kleur.green : kleur.red)(successTxt)}\n${output}`);
                session.send(`执行${successTxt}\n${output}`);
            }
            else {
                session.send('权限不足');
            }
        }
        // 服务器状态
        else if (txtContent === cmdStatus) {
            await this.sendStatus(session);
        }
        // 群消息转服务器
        if (groupChatTemplate) {
            let message = await koishi.h.transformAsync(content, this.transformMsgRules, session);
            if (session.quote)
                message = `${this.addHeadAndTail(await this.translateReply(session))} ${message}`;
            const { username, nickname } = session.author || {};
            const rendered = mustache.render(groupChatTemplate, {
                session,
                message,
                name: username || nickname || '未知',
            });
            mc.broadcast(rendered);
        }
    }
    async onPoke(session) {
        const { pokeStatus } = this.config;
        if (pokeStatus)
            await this.sendStatus(session);
    }
    onMcChat(player, message) {
        const { playerChatTemplate } = this.config;
        if (playerChatTemplate) {
            const rendered = mustache.render(playerChatTemplate, {
                player,
                message,
            });
            this.broadcastMsg(rendered);
        }
    }
    onMcPreJoin(player) {
        const { playerPreJoinTemplate } = this.config;
        if (playerPreJoinTemplate) {
            const rendered = mustache.render(playerPreJoinTemplate, {
                player,
            });
            this.broadcastMsg(rendered);
        }
    }
    onMcJoin(player) {
        const { playerJoinTemplate } = this.config;
        if (playerJoinTemplate) {
            const rendered = mustache.render(playerJoinTemplate, {
                player,
            });
            this.broadcastMsg(rendered);
        }
    }
    onMcLeft(player) {
        const { playerLeftTemplate } = this.config;
        if (playerLeftTemplate) {
            const rendered = mustache.render(playerLeftTemplate, {
                player,
            });
            this.broadcastMsg(rendered);
        }
    }
    onMcDie(player, source) {
        const { playerDieTemplate } = this.config;
        if (playerDieTemplate) {
            const rendered = mustache.render(playerDieTemplate, {
                player,
                source,
            });
            this.broadcastMsg(rendered);
        }
    }
}

module.exports = Plugin;
