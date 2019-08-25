// Nodejs dependencies
const path = require('path');
const EventEmitter = require('events');

class HotsGameDataBase extends EventEmitter {

    /**
     * @param {PluginBase} plugin
     */
    constructor(plugin) {
        super();
        this.plugin = plugin;
        this.language = plugin.getConfigValue("language");
        this.languageOptions = [{ id: "en-us", name: "English (US)" }];
        this.maps = {
            name: {}
        };
        this.heroes = {
            name: {},
            details: {},
            corrections: {}
        };
        this.replays = {
            details: [],
            fileNames: [],
            latestReplay: { file: null, mtime: 0 },
            lastUpdate: 0
        };
        this.playerPicks = {};
        this.playerBattleTags = {};
    }

    /**
     * Returns the game data in a json serializable form
     * @returns {object}
     */
    toJSON() {
        return {
            formatVersion: 5,
            languageOptions: this.languageOptions,
            maps: this.maps,
            heroes: this.heroes,
            replays: this.replays,
            playerPicks: this.playerPicks,
            playerBattleTags: this.playerBattleTags
        };
    }

    /**
     * Load data from a json form of game data
     * @param cacheData
     */
    loadFromJSON(cacheData) {
        try {
            if (typeof cacheData !== "object") {
                cacheData = JSON.parse(cacheData);
            }
            if (cacheData.formatVersion == 5) {
                this.languageOptions = cacheData.languageOptions;
                this.maps = cacheData.maps;
                this.heroes = cacheData.heroes;
                this.replays = cacheData.replays;
                this.playerPicks = cacheData.playerPicks;
                this.playerBattleTags = cacheData.playerBattleTags;
                // Reset failed / unfinished replay uploads
                for (let i = 0; i < this.replays.details.length; i++) {
                    for (let uploadProvider in this.replays.details[i].replayUploads) {
                        if (this.replays.details[i].replayUploads[uploadProvider].result === "pending") {
                            delete this.replays.details[i].replayUploads[uploadProvider];
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Failed to read gameData data!");
            console.error(e);
        }
    }

    /**
     * @param {string} fromName
     * @param {string} toId
     * @param {string|undefined} language
     */
    addHeroCorrection(fromName, toId, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        if (!this.heroes.corrections.hasOwnProperty(language)) {
            this.heroes.corrections[language] = {};
        }
        this.heroes.corrections[language][fromName] = this.getHeroName(toId, language);
    }

    /**
     * @param {string} name
     * @param {string|undefined} language
     * @returns {string}
     */
    correctHeroName(name, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        if (!this.heroes.corrections.hasOwnProperty(language)) {
          this.heroes.corrections[language] = {};
        }
        if (this.heroes.corrections[language].hasOwnProperty(name)) {
            return this.heroes.corrections[language][name];
        }
        return name;
    }

    /**
     * @param name
     * @param language
     * @returns {boolean}
     */
    heroExists(name, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        return (this.getHeroId(name, language) !== null);
    }

    /**
     * @param name
     * @param language
     * @returns {boolean}
     */
    mapExists(name, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        return (this.getMapId(name, language) !== null);
    }

    /**
     * @param name
     * @returns {string}
     */
    fixMapName(name) {
        name = name.toUpperCase().trim();
        return name;
    }

    /**
     * @param name
     * @returns {string}
     */
    fixHeroName(name) {
        name = name.toUpperCase().trim();
        return name;
    }

    /**
     * @param mapName
     * @param language
     * @returns {string|null}
     */
    getMapId(mapName, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        if (!this.maps.name.hasOwnProperty(language)) {
            this.maps.name[language] = {};
        }
        for (let mapId in this.maps.name[language]) {
            if (this.maps.name[language][mapId] === mapName) {
                return mapId;
            }
        }
        return null;
    }

    /**
     * @param mapId
     * @param language
     * @returns {*}
     */
    getMapName(mapId, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        if (!this.maps.name.hasOwnProperty(language)) {
            this.maps.name[language] = {};
        }
        return this.maps.name[language][mapId];
    }

    /**
     * @param mapName
     * @param language
     * @returns {*}
     */
    getMapNameTranslation(mapName, language) {
        if (language === this.language) {
            // Same language, leave it as is
            return mapName;
        }
        // Get the map id in the current language
        let mapId = this.getMapId(mapName);
        // Return the map name in the desired language
        return this.getMapName(mapId, language);
    }

    /**
     * @param language
     * @returns {*}
     */
    getMapNames(language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        if (!this.maps.name.hasOwnProperty(language)) {
            this.maps.name[language] = {};
        }
        return this.maps.name[language];
    }

    /**
     * @param heroId
     * @param language
     * @returns {*}
     */
    getHeroName(heroId, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        if (!this.heroes.name.hasOwnProperty(language)) {
            this.heroes.name[language] = {};
        }
        return this.heroes.name[language][heroId];
    }

    /**
     * @param heroName
     * @param language
     * @returns {*}
     */
    getHeroNameTranslation(heroName, language) {
        if (language === this.language) {
            // Same language, leave it as is
            return heroName;
        }
        // Get the hero id in the current language
        let heroId = this.getHeroId(heroName);
        // Return the hero name in the desired language
        return this.getHeroName(heroId, language);
    }

    /**
     * @param language
     * @returns {*}
     */
    getHeroNames(language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        if (!this.heroes.name.hasOwnProperty(language)) {
            this.heroes.name[language] = {};
        }
        return this.heroes.name[language];
    }

    /**
     * @param heroName
     * @param language
     * @returns {string|null}
     */
    getHeroId(heroName, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        if (!this.heroes.name.hasOwnProperty(language)) {
            this.heroes.name[language] = {};
        }
        for (let heroId in this.heroes.name[language]) {
            if ((this.heroes.name[language][heroId] === heroName) || (heroId === heroName.toLowerCase())) {
                return heroId;
            }
        }
        return null;
    }

    /**
     * @param heroName
     * @param language
     * @returns {string}
     */
    getHeroImage(heroName, language) {
        if ((typeof heroName === "undefined") || (heroName === null)) {
            return null;
        }
        if (typeof language === "undefined") {
            language = this.language;
        }
        heroName = this.fixHeroName(heroName);
        let heroId = this.getHeroId(heroName, language);
        if (heroId === null) {
            console.error("Failed to find image for hero: "+heroName);
            return null;
        }
        return path.join(this.plugin.path, "data", "heroes", heroId+"_crop.png");
    }

}

module.exports = HotsGameDataBase;
