const fs = require('fs');
const path = require('path');
const GamingBuddyPluginBackend = require("@forsaken87/gaming-buddy-plugins").PluginBackend;

// Local classes
const HotsDraft = require('./hots/draft.js');
const HotsGameData = require("./hots/game-data.js");
const HotsHelpers = require('./hots/helpers.js');

// Local constants
const gameStateMenus = 0;
const gameStateDrafting = 1;
const gameStatePlaying = 2;

class BlizzHotsBackend extends GamingBuddyPluginBackend {

    // Local constants
    static get gameStateMenus() {
        return gameStateMenus;
    }

    static get gameStateDrafting() {
        return gameStateDrafting;
    }

    static get gameStatePlaying() {
        return gameStatePlaying;
    }

    /**
     * Plugin backend constructor
     * @param {App} app
     * @param {string} pluginName
     * @param {string} pluginDirectory
     * @param {object} pluginConfig
     */
    constructor(app, pluginName, pluginDirectory, pluginConfig) {
        super(app, pluginName, pluginDirectory, pluginConfig);
        if (pluginConfig.values['game-storage-dir'] == "") {
            pluginConfig.values['game-storage-dir'] = HotsHelpers.detectGameStorageDir();
            this.setConfigValues(pluginConfig.values);
        }
        if (pluginConfig.values['game-temp-dir'] == "") {
            pluginConfig.values['game-temp-dir'] = HotsHelpers.detectGameTempDir();
            this.setConfigValues(pluginConfig.values);
        }
        this.draft = new HotsDraft(this);
        this.gameData = new HotsGameData(this);
        this.gameState = gameStateMenus;
        this.draftProvider = null;
        this.talentProvider = null;
        this.replayProviders = [];
        // Update game data on startup
        this.gameData.update().then(() => {
            let languageOptions = {};
            for (let i = 0; i < this.gameData.languageOptions.length; i++) {
                languageOptions[this.gameData.languageOptions[i].id] = this.gameData.languageOptions[i].name;
            }
            this.config.setSelectOptions("language", languageOptions);
            this.sendConfigToGui();
            this.sendMessage("gameData", this.gameData);
            this.gameData.uploadReplays();
        });
        // Bind events
        this.bindEvents();
        // Load providers
        this.setDraftProvider(this.config.values['draft-provider']);
        this.setTalentProvider(this.config.values['talents-provider']);
        this.loadReplayProviders();
        // Initialize pages
        this.on("ready", () => {
            this.addPageNav("draft", "Draft-Tool", "fa fa-poll");
            this.addPageNav("talents", "Talents", "fa fa-gem");
            this.addPageNav("replays", "Replays", "fa fa-video");
        })
    }

    /**
     * Bind events
     */
    bindEvents() {
        // Draft changed
        this.draft.on("start", () => {
            this.sendMessage("draft", this.draft);
        });
        // Map changed
        this.draft.on("map.update", (mapName) => {
            this.sendMessage("draft.map", mapName);
        });
        // Ban changed
        this.draft.on("ban.update", (team, banIndex) => {
            this.sendMessage("draft.ban", {
                team: team.color,
                index: banIndex,
                hero: team.bans[banIndex],
                heroImage: (team.banImageData[banIndex] !== null ? team.banImageData[banIndex].toString("base64") : null),
                locked: (team.bansLocked > banIndex)
            });
        });
        // Player changed
        this.draft.on("player.update", (team, player) => {
            this.sendMessage("draft.player", player);
        });
        // Replay updated
        this.gameData.on("replay.update", (replayIndex) => {
            this.sendMessage("replay.update", replayIndex, this.gameData.replays.details[replayIndex]);
        });
    }

    /**
     * Check if the plugin is currently active
     * @param window
     * @returns {boolean}
     */
    checkActive(window) {
        return window.title.match(/^Heroes of the Storm/);
    }

    /**
     * @param type
     * @param parameters
     */
    handleMessage(type, parameters) {
        switch (type) {
            case "ban.learn":
                this.draft.saveHeroBanImage(...parameters);
                break;
            case "hero.learn":
                this.gameData.addHeroCorrection(...parameters);
                break;
            case "draft.provider":
                if (this.draftProvider !== null) {
                    this.draftProvider.handleGuiAction(parameters);
                }
                break;
            default:
                super.handleMessage(type, parameters);
                break;
        }
    }

    /**
     * Configuration changed
     * @param configValues
     */
    setConfigValues(configValues) {
        if (configValues['draft-provider'] !== this.config.values['draft-provider']) {
            this.setDraftProvider(configValues['draft-provider']);
        }
        if (configValues['talents-provider'] !== this.config.values['talents-provider']) {
            this.setTalentProvider(configValues['talents-provider']);
        }
        super.setConfigValues(configValues);
    }

    /**
     * Update plugin
     * @returns {Promise}
     */
    update() {
        if (this.config.values['game-temp-dir'] == "") {
            this.config.values['game-temp-dir'] = HotsHelpers.detectGameTempDir();
            this.setConfigValues(this.config.values);
        }
        return this.gameData.updateSaves().then(() => {
            return this.gameData.updateReplays();
        }).then(() => {
            // Check if game state changed
            let prevState = this.gameState;
            if (this.gameData.isGameActive()) {
                this.gameState = gameStatePlaying;
                return Promise.resolve(prevState);
            } else {
                return this.draft.update().then((draftActive) => {
                    if (draftActive) {
                        this.gameState = gameStateDrafting;
                    } else {
                        this.gameState = gameStateMenus;
                    }
                    return Promise.resolve(prevState);
                });
            }
        }).then((prevState) => {
            // State changed?
            if (this.gameState !== prevState) {
                if (prevState === gameStatePlaying) {
                    // Game ended
                    this.emit("game.end");
                    this.draft.clear();
                }
                if (prevState === gameStateDrafting) {
                    // Draft ended
                    this.emit("draft.end");
                }
                if (this.gameState === gameStatePlaying) {
                    // Game started
                    this.setFrontendPage("talents");
                    this.emit("game.start");
                }
                if (this.gameState === gameStateDrafting) {
                    // Draft started
                    this.setFrontendPage("draft");
                    this.emit("draft.start");
                }
            }
            // Delay update while game is active
            if (this.gameState === gameStatePlaying) {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(this.gameState);
                    }, 5000)
                });
            }
            // Return game state
            return Promise.resolve(this.gameState);
        });
    }

    setDraftProvider(providerName) {
        if (typeof providerName === "undefined") {
            providerName = null;
        }
        // Remove current draft provider
        if (this.draftProvider !== null) {
            this.draftProvider.detach();
            this.draftProvider = null;
            this.sendMessage("draft.provider.change", null);
        }
        // Init new draft provider
        if (providerName !== null) {
            let providerClass = require(path.resolve(__dirname, "providers", "draft-suggestions", providerName + ".js"));
            this.draftProvider = new providerClass(this);
            this.draftProvider.init();
            this.draftProvider.on("change", () => {
                this.sendMessage("draft.provider.change", {
                    template: this.draftProvider.getTemplate(),
                    templateData: this.draftProvider.getTemplateData()
                });
            });
        }
    }

    setTalentProvider(providerName) {
        if (typeof providerName === "undefined") {
            providerName = null;
        }
        // Remove current talent provider
        if (this.talentProvider !== null) {
            this.talentProvider.detach();
            this.talentProvider = null;
            this.sendMessage("talent.provider.change", null);
        }
        // Init new talent provider
        if (providerName !== null) {
            let providerClass = require(path.resolve(__dirname, "providers", "talent-suggestions", providerName + ".js"));
            this.talentProvider = new providerClass(this);
            this.talentProvider.init();
            this.talentProvider.on("change", () => {
                this.sendMessage("talent.provider.change", {
                    template: this.talentProvider.getTemplate(),
                    templateData: this.talentProvider.getTemplateData()
                });
            });
        } else {
            this.talentProvider = null;
        }
    }

    loadReplayProviders() {
        this.replayProviders = [];
        if (this.config.values.hasOwnProperty("replays-hotsapi")) {
            this.replayProviders.push(new require(path.resolve(__dirname, "providers", "replay-uploaders", "hotsapi.js")));
        }
    }
}

module.exports = BlizzHotsBackend;