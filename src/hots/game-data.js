// Nodejs dependencies
const request = require('request');
const cheerio = require('cheerio');
const https = require('https');
const fs = require('fs');
const path = require('path');
const jimp = require('jimp');
const {BigQuery} = require('@google-cloud/bigquery');
const HotsReplay = require('hots-replay');

// Local classes
const HotsGameDataBase = require("./game-data-base.js");
const HotsReplayUploaders = {
    "hotsapi": require('../providers/replay-uploaders/hotsapi.js')
};

// BigQuery Instance
let bigQueryHotsApi = null;

class HotsGameData extends HotsGameDataBase {

    /**
     * @param {BlizzHotsBackend} pluginBackend
     */
    constructor(pluginBackend) {
        super(pluginBackend);
        this.plugin = pluginBackend;
        new BigQuery({
            projectId: pluginBackend.getConfigValue("statistics-big-query-project"),
            keyFilename: pluginBackend.getConfigValue("statistics-big-query-auth-file")
        });
        this.saves = {
            latestSave: { file: null, mtime: 0 },
            lastUpdate: 0
        };
        this.updateProgress = {
            tasksPending: 0,
            tasksDone: 0,
            tasksFailed: 0,
            retries: 0
        };
        this.gameActiveLock = 0;
        // BigQuery Instance
        bigQueryHotsApi = new BigQuery({
            projectId: this.plugin.getConfigValue("statistics-big-query-project"),
            keyFilename: this.plugin.getConfigValue("statistics-big-query-auth-file")
        });
        // Load gameData and exceptions from disk
        this.load();
    }
    addHero(id, name, language) {
        name = this.fixHeroName(name);
        if (!this.heroExists(name, language)) {
            this.heroes.name[language][id] = name;
        }
    }
    addMap(id, name, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        name = this.fixMapName(name);
        if (!this.mapExists(name, language)) {
            this.maps.name[language][id] = name;
        }
    }
    addHeroDetails(id, details, language) {
        if (language === this.language) {
            this.heroes.details[id] = details;
        }
    }
    addHeroCorrection(fromName, toId, language) {
        super.addHeroCorrection(fromName, toId, language);
        this.save();
    }

    addReplay(replayFile) {
        return new Promise((resolve, reject) => {
            this.progressTaskNew();
            this.loadReplay(replayFile).then((replayData) => {
                this.replays.fileNames.push(replayFile);
                if (replayData !== null) {
                    this.replays.details.push(replayData);
                    if (this.replays.latestReplay.mtime < replayData.mtime) {
                        this.replays.latestReplay = replayData;
                    }
                }
                this.progressTaskDone();
                resolve(replayData);
            }).catch((error) => {
                this.progressTaskFailed();
                reject(error);
            });
        });
    }
    loadReplay(replayFile) {
        return new Promise((resolve, reject) => {
            try {
                let fileStats = fs.statSync(replayFile);
                let replay = new HotsReplay(replayFile);
                let replayData = {
                    file: replayFile,
                    mtime: fileStats.mtimeMs,
                    replayDetails: replay.getReplayDetails(),
                    replayUploads: {}
                };
                let battleTags = replay.getReplayBattleLobby().battleTags;
                // Keep information about recent player picks
                for (let i = 0; i < replayData.replayDetails.m_playerList.length; i++) {
                    let player = replayData.replayDetails.m_playerList[i];
                    if (battleTags.length > i) {
                        // Add battle tag
                        let playerBattleTag = battleTags[i].tag;
                        if (!this.playerBattleTags.hasOwnProperty(player.m_name)) {
                            this.playerBattleTags[player.m_name] = [];
                        }
                        if (this.playerBattleTags[player.m_name].indexOf(playerBattleTag) === -1) {
                            this.playerBattleTags[player.m_name].push(playerBattleTag);
                        }
                    }
                }
                // Return replay data
                resolve(replayData);
            } catch (error) {
                reject(error);
            }
        });
    }
    downloadHeroIcon(heroId, heroImageUrl) {
        return new Promise((resolve, reject) => {
            let filename = path.join(this.plugin.path, "data", "heroes", heroId+".png");
            let filenameCrop = path.join(this.plugin.path, "data", "heroes", heroId+"_crop.png");
            if (!fs.existsSync(filename)) {
                try {
                    // Create cache directory if it does not exist
                    let heroesDir = path.join(this.plugin.path, "data", "heroes");
                    if (!fs.existsSync( heroesDir )) {
                        fs.mkdirSync(heroesDir, { recursive: true });
                    }
                    https.get(heroImageUrl, function(response) {
                        const file = fs.createWriteStream(filename);
                        const stream = response.pipe(file);
                        stream.on("finish", () => {
                            jimp.read(filename).then(async (image) => {
                                image.crop(10, 32, 108, 64).write(filenameCrop);
                                resolve();
                            }).catch((error) => {
                                console.error("Error loading image '"+heroImageUrl+"'");
                                console.error(error);
                                console.error(error.stack);
                                reject(error);
                            })
                        })
                    });
                } catch(error) {
                    reject(error);
                }
            } else {
                resolve();
            }
        });
    }
    correctHeroName(name, language) {
        if (typeof language === "undefined") {
            language = this.language;
        }
        name = this.fixHeroName(name);
        if (!this.heroes.corrections.hasOwnProperty(language)) {
          this.heroes.corrections[language] = {};
        }
        if (this.heroes.corrections[language].hasOwnProperty(name)) {
            return this.heroes.corrections[language][name];
        }
        return name;
    }
    getAccounts() {
        if (this.plugin.getConfigValue("game-storage-dir") === "") {
            return [];
        }
        let accounts = [];
        let files = fs.readdirSync(path.join(this.plugin.getConfigValue("game-storage-dir"), "Accounts"));
        files.forEach((file) => {
            if (file.match(/^[0-9]+$/)) {
                accounts.push({
                    id: file,
                    players: this.getPlayers(file)
                });
            }
        });
        return accounts;
    }
    getPlayers(accountId = null) {
        if (this.plugin.getConfigValue("game-storage-dir") === "") {
            return [];
        }
        if (accountId !== null) {
            let players = [];
            let files = fs.readdirSync(path.join(this.plugin.getConfigValue("game-storage-dir"), "Accounts", accountId));
            files.forEach((file) => {
                if (file.match(/^[0-9]+\-Hero\-[0-9]+\-[0-9]+$/)) {
                    players.push(file);
                }
            });
            return players;
        } else {
            let players = [];
            let accounts = this.getAccounts();
            for (let i = 0; i < accounts.length; i++) {
                players.push( ...this.getPlayers(accounts[i].id) );
            }
            return players;
        }
    }
    getFile() {
        return path.join(this.plugin.path, "data", "gameData.json");
    }
    getLatestReplay() {
        return this.replays.latestReplay;
    }
    getLatestSave() {
        return this.saves.latestSave;
    }
    getSelectedHero() {
        let baseDir = this.plugin.getConfigValue("game-temp-dir");
        if ((baseDir === "") || !fs.existsSync(baseDir)) {
            return null;
        }
        let trackerFile = path.join(baseDir, "TempWriteReplayP1", "replay.tracker.events");
        if (fs.existsSync(trackerFile)) {
            let trackerBuffer = new HotsReplay.Buffer(fs.readFileSync(trackerFile));
            let events = HotsReplay.Decoder.decode_event_stream(trackerBuffer, "tracker_eventid_typeid", "tracker_event_types", false);
            let playerHandles = this.getPlayers();
            let playerId = null;
            for (let i = 0; i < events.length; i++) {
                if (playerId === null) {
                    if (events[i].m_eventName === "PlayerInit") {
                        let playerHandle = HotsReplay.Decoder.getMapValue(events[i].m_stringData, 'ToonHandle');
                        if (playerHandles.indexOf(playerHandle) !== -1) {
                            playerId = HotsReplay.Decoder.getMapValue(events[i].m_intData, 'PlayerID');
                        }
                    }
                } else {
                    if (events[i].m_eventName === "PlayerSpawned") {
                        let spawnPlayerId = HotsReplay.Decoder.getMapValue(events[i].m_intData, 'PlayerID');
                        if (playerId == spawnPlayerId) {
                            let spawnHero = HotsReplay.Decoder.getMapValue(events[i].m_stringData, 'Hero');
                            let spawnHeroId = spawnHero.substr(4).toLowerCase();
                            let spawnHeroName = this.getHeroName(spawnHeroId);
                            if ((typeof spawnHeroName === "undefined") || (spawnHeroName === null)) {
                                return spawnHeroId;
                            } else {
                                return spawnHeroName;
                            }
                        }
                    }
                }
            }
        }
        return null;
    }
    isGameActive() {
        let now = (new Date()).getTime();
        if (now < this.gameActiveLock) {
            return true;
        }
        let tempFileAge = (now - this.updateTempModTime()) / 1000;
        if (tempFileAge < 60) {
            return true;
        }
        if (this.saves.latestSave !== null) {
            let latestSaveAge = (now - this.saves.latestSave.mtime) / 1000;
            if ((this.saves.latestSave.mtime - this.replays.latestReplay.mtime) / 1000 > 30) {
                return (latestSaveAge < 150);
            } else {
                // New replay available, game is done!
                return false;
            }
        } else {
            return false;
        }
    }
    update() {
        this.plugin.debugStatus("Updating game data ...");
        this.progressReset();
        this.progressTaskNew();
        return new Promise((resolve, reject) => {
            let updatePromises = [
              this.updateReplays(),
              this.updateSaves(),
              this.updateMaps("en-us"),
              this.updateHeroes("en-us")
            ];
            if (this.language !== "en-us") {
                updatePromises.push( this.updateMaps(this.language) );
                updatePromises.push( this.updateHeroes(this.language) );
            }
            Promise.all(updatePromises).then((result) => {
                resolve(result);
            }).catch((error) => {
                if (this.updateProgress.retries++ < 3) {
                    // Retry
                    this.update().then((result) => {
                        resolve(result)
                    }).catch((error) => {
                        reject(error);
                    });
                } else {
                    reject(error);
                }
            }).finally(() => {
                this.emit("update.done");
            });
        }).then((result) => {
            this.progressTaskDone();
            return result;
        }).catch((error) => {
            this.progressTaskFailed();
            throw error;
        }).finally(() => {
            this.plugin.debugStatus("Updating game data done!");
            this.emit("update.done");
        });
    }
    updateMaps(language) {
        this.plugin.debugStatus("Updating game data (maps) ...");
        this.progressTaskNew();
        let url = "https://heroesofthestorm.com/"+language+"/battlegrounds/";
        return new Promise((resolve, reject) => {
            request({
                'method': 'GET',
                'uri': url,
                'headers': {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36'
                },
                'jar': true
            }, (error, response, body) => {
                if (error || (typeof response === "undefined")) {
                    reject(error);
                    return;
                }
                if (response.statusCode !== 200) {
                    reject('Invalid status code <' + response.statusCode + '>\n'+body);
                    return;
                }
                this.updateMapsFromResponse(language, body).then(() => {
                    resolve();
                }).catch((error) => {
                    reject(error);
                });
            });
        }).then((result) => {
            this.progressTaskDone();
            return result;
        }).catch((error) => {
            this.progressTaskFailed();
            throw error;
        });
    }
    updateMapsFromResponse(language, content) {
        return new Promise((resolve, reject) => {
            let self = this;
            let page = cheerio.load(content);
            let languages = [];
            page(".BattlegroundText-header").each(function() {
                let mapId = page(this).closest(".BattlegroundWrapper-container").attr("data-battleground-id");
                self.addMap( mapId, page(this).text(), language );
            });
            page(".NavbarFooter-selectorLocales [data-id]").each(function() {
                languages.push({
                    id: page(this).attr("data-id"),
                    name: page(this).find(".NavbarFooter-selectorOptionLabel").text()
                });
            });
            this.languageOptions = languages;
            resolve();
            this.save();
        });
    }
    updateHeroes(language) {
        this.plugin.debugStatus("Updating game data (heroes) ...");
        this.progressTaskNew();
        let url = "https://heroesofthestorm.com/"+language+"/heroes/";
        return new Promise((resolve, reject) => {
            request({
                'method': 'GET',
                'uri': url,
                'headers': {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36'
                },
                'jar': true
            }, (error, response, body) => {
                if (error || (typeof response === "undefined")) {
                    reject(error);
                    return;
                }
                if (response.statusCode !== 200) {
                    reject('Invalid status code <' + response.statusCode + '>\n'+body);
                    return;
                }
                this.updateHeroesFromResponse(language, body).then(() => {
                    resolve();
                }).catch((error) => {
                    reject(error);
                });
            });
        }).then((result) => {
            this.progressTaskDone();
            return result;
        }).catch((error) => {
            this.progressTaskFailed();
            throw error;
        });
    }
    updateHeroesFromResponse(language, content) {
        return new Promise((resolve, reject) => {
            let self = this;
            let page = cheerio.load(content);
            // Load heroesByName
            const heroDataVar = "window.blizzard.hgs.heroData";
            let downloads = [];
            page("script").each(function() {
                let script = page(this).html();
                if (script.indexOf(heroDataVar) === 0) {
                    let heroDataRaw = script.substr(heroDataVar.length + 3);
                    heroDataRaw = heroDataRaw.substr(0, heroDataRaw.indexOf(";\n"));
                    let heroData = JSON.parse(heroDataRaw);
                    for (let i = 0; i < heroData.length; i++) {
                        let hero = heroData[i];
                        let heroId = hero.slug;
                        let heroImageUrl = hero.circleIcon;
                        let heroName = self.fixHeroName(hero.name);
                        self.addHero(heroId, heroName, language);
                        self.addHeroDetails(heroId, hero, language);
                        if (language === "en-us") {
                            self.progressTaskNew();
                            let downloadPromise = self.downloadHeroIcon(heroId, heroImageUrl);
                            downloadPromise.then(() => {
                                self.progressTaskDone();
                            }).catch((error) => {
                                self.progressTaskFailed();
                            });
                            downloads.push(downloadPromise);
                        }
                    }
                }
            });
            if (downloads.length > 0) {
                Promise.all(downloads).then(() => {
                    resolve(true);
                }).catch((error) => {
                    reject(error);
                });
            } else {
                // No downloads pending, done!
                resolve(true);
            }
            this.save();
        });
    }
    updateLanguage() {
        this.language = this.plugin.getConfigValue("language");
        this.update();
    }
    updateReplays() {
        this.plugin.debugStatus("Updating game data (replays) ...");
        this.progressTaskNew();
        return new Promise((resolve, reject) => {
            // Do not update replays more often than every 30 seconds
            let replayUpdateAge = ((new Date()).getTime() - this.replays.lastUpdate) / 1000;
            if (replayUpdateAge < 30) {
                resolve(true);
                return;
            }
            // Update replays
            let accounts = this.getAccounts();
            let gameStorageDir = this.plugin.getConfigValue("game-storage-dir");
            let replayTasks = [];
            for (let a = 0; a < accounts.length; a++) {
                for (let p = 0; p < accounts[a].players.length; p++) {
                    let replayPath = path.join(gameStorageDir, "Accounts", accounts[a].id, accounts[a].players[p], "Replays", "Multiplayer");
                    let files = fs.readdirSync(replayPath);
                    files.forEach((file) => {
                        if (file.match(/\.StormReplay$/)) {
                            let fileAbsolute = path.join(replayPath, file);
                            if (this.replays.fileNames.indexOf(fileAbsolute) === -1) {
                                // New replay detected
                                replayTasks.push( this.addReplay(fileAbsolute) );
                            }
                        }
                    });
                }
            }
            this.replays.lastUpdate = (new Date()).getTime();
            if (replayTasks.length === 0) {
                resolve(true);
            } else {
                Promise.all(replayTasks).then((replays) => {
                    // Sort replays (newest first)
                    this.replays.details.sort((a, b) => {
                        return b.mtime - a.mtime;
                    });
                    // Only sore the details for the latest 100 replays
                    if (this.replays.details.length > 100) {
                        this.replays.details.splice(100);
                    }
                    // Update done!
                    resolve(true);
                }).catch((error) => {
                    reject(error);
                });
            }
        }).then((result) => {
            // Try to detect the player name
            if ((this.plugin.getConfigValue("game-player-name") === "") && (this.replays.details.length > 10)) {
                let playerNames = {};
                let playerBestCount = 0;
                let playerBestName = "";
                for (let i = 0; i < this.replays.details.length; i++) {
                    let replayData = this.replays.details[i];
                    for (let p = 0; p < replayData.replayDetails.m_playerList.length; p++) {
                        let player = replayData.replayDetails.m_playerList[p];
                        if (!playerNames.hasOwnProperty(player.m_name)) {
                            playerNames[player.m_name] = 1;
                        } else {
                            playerNames[player.m_name]++;
                        }
                        if (playerNames[player.m_name] > playerBestCount) {
                            playerBestCount = playerNames[player.m_name];
                            playerBestName = player.m_name;
                        }
                    }
                }
                this.plugin.setConfigValue("game-player-name", playerBestName);
                this.plugin.sendConfigToGui();
            }
            this.progressTaskDone();
            return result;
        }).catch((error) => {
            this.progressTaskFailed();
            throw error;
        });
    }
    uploadReplays() {
        // Check upload state
        let uploadPromise = Promise.resolve(0);
        if (!this.plugin.getConfigValue("replays")) {
            // Replay uploading disabled
            return uploadPromise;
        }
        for (var uploadProvider in HotsReplayUploaders) {
            if (!this.plugin.getConfigValue("replays-"+uploadProvider)) {
                // Skip disabled providers
                continue;
            }
            for (let i = 0; i < this.replays.details.length; i++) {
                let replayData = this.replays.details[i];
                if (typeof replayData.replayUploads[uploadProvider] === "undefined") {
                    // Not uploaded yet
                    replayData.replayUploads[uploadProvider] = { result: "pending" };
                    this.emit("replay.update", i);
                    uploadPromise = uploadPromise.then((uploadCount) => {
                        uploadCount++;
                        return new Promise((resolve, reject) => {
                            this.plugin.debugStatus("Uploading replay '"+path.basename(replayData.file)+"' via "+uploadProvider+"...");
                            HotsReplayUploaders[uploadProvider].upload(replayData.file).then((result) => {
                                replayData.replayUploads[uploadProvider] = { result: result };
                                this.emit("replay.update", i);
                                this.save();
                                resolve(uploadCount);
                            }).catch((error) => {
                                replayData.replayUploads[uploadProvider] = { result: "error", error: error };
                                this.emit("replay.update", i);
                                this.save();
                                resolve(uploadCount);
                            });
                        });
                    });
                }
            }
        }
        return uploadPromise;
    }
    updateSaves() {
        this.plugin.debugStatus("Updating game data (saves) ...");
        this.progressTaskNew();
        return new Promise((resolve, reject) => {
            // Do not update saves more often than every 10 seconds
            let savesUpdateAge = ((new Date()).getTime() - this.saves.lastUpdate) / 1000;
            if (savesUpdateAge < 10) {
                resolve(true);
                return;
            }
            // Update saves
            let accounts = this.getAccounts();
            let gameStorageDir = this.plugin.getConfigValue("game-storage-dir");
            for (let a = 0; a < accounts.length; a++) {
                for (let p = 0; p < accounts[a].players.length; p++) {
                    let replayPath = path.join(gameStorageDir, "Accounts", accounts[a].id, accounts[a].players[p], "Saves", "Rejoin");
                    let files = fs.readdirSync(replayPath);
                    files.forEach((file) => {
                        if (file.match(/\.StormSave$/)) {
                            let fileAbsolute = path.join(replayPath, file);
                            let fileStats = fs.statSync(path.join(replayPath, file));
                            if ((this.saves.latestSave.mtime < fileStats.mtimeMs) || (this.saves.latestSave.file === fileAbsolute)) {
                                this.saves.latestSave.file = fileAbsolute;
                                this.saves.latestSave.mtime = fileStats.mtimeMs;
                            }
                        }
                    });
                }
            }
            this.saves.lastUpdate = (new Date()).getTime();
            resolve(true);
        }).then((result) => {
            this.progressTaskDone();
            return result;
        }).catch((error) => {
            this.progressTaskFailed();
            throw error;
        });
    }
    updateTempModTime() {
        return this.updateTempFilesRecursive(
            this.plugin.getConfigValue("game-temp-dir")
        );
    }
    updateTempFilesRecursive(baseDir) {
        if (!fs.existsSync(baseDir)) {
            return 0;
        }
        let files = fs.readdirSync(baseDir);
        let maxMtime = 0;
        try {
            files.forEach((file) => {
                let fileAbsolute = path.join(baseDir, file);
                let fileLstat = fs.lstatSync(fileAbsolute);
                if (fileLstat.isDirectory()) {
                    let dirMtime = this.updateTempFilesRecursive(fileAbsolute);
                    if (maxMtime < dirMtime) {
                        maxMtime = dirMtime;
                    }
                } else {
                    let fileStats = fs.statSync(fileAbsolute);
                    if (fileStats.isDirectory())
                    if (maxMtime < fileStats.mtimeMs) {
                        maxMtime = fileStats.mtimeMs;
                    }
                }
            });
        } catch (error) {
            // May happen when files or directories are deleted
            console.error(error);
        }
        return maxMtime;
    }

    /**
     * @param {HotsDraftPlayer} player
     */
    updatePlayerRecentPicks(player) {
        let playerName = player.getName();
        if (!this.playerBattleTags.hasOwnProperty(playerName)) {
            // No battletags known for player! Unable to fetch recent picks.
            return;
        }
        let playerPicks = {};
        for (let i = 0; i < this.playerBattleTags[playerName].length; i++) {
            let playerBattleTag = this.playerBattleTags[playerName][i];
            if (!this.playerPicks.hasOwnProperty(playerBattleTag)) {
                // No recent picks known for player! Fetch from hotsapi.net
                this.playerPicks[playerBattleTag] = [];
                let playerBattleTagParts = playerBattleTag.match(/^(.+)#([0-9]+)$/);
                if (playerBattleTagParts) {
                    let querySql = `
                      SELECT p.hero as heroName, COUNT(*) as pickCount
                      FROM \`cloud-project-179020.hotsapi.replays\` r, UNNEST(players) as p
                      WHERE (p.battletag_name = @tagName) AND (p.battletag_id = @tagId)
                      GROUP BY heroName
                      ORDER BY pickCount DESC`;
                    let queryOptions = {
                        query: querySql,
                        params: { tagName: playerBattleTagParts[1], tagId: parseInt(playerBattleTagParts[2]) }
                    };
                    bigQueryHotsApi.query(queryOptions).then((result) => {
                        result[0].forEach((row) => {
                            this.playerPicks[playerBattleTag].push([ row.heroName, row.pickCount ]);
                        });
                        playerPicks[playerBattleTag] = this.playerPicks[playerBattleTag];
                        player.setRecentPicks(playerPicks);
                        this.save();
                    });
                }
                return;
            } else {
                playerPicks[playerBattleTag] = this.playerPicks[playerBattleTag];
                player.setRecentPicks(playerPicks);
            }
        }
    }
    progressReset() {
        this.updateProgress.tasksPending = 1;
        this.updateProgress.tasksDone = 0;
        this.updateProgress.tasksFailed = 0;
        this.progressRefresh();
    }
    progressTaskNew() {
        this.updateProgress.tasksPending++;
        this.progressRefresh();
    }
    progressTaskDone() {
        this.updateProgress.tasksDone++;
        this.progressRefresh();
    }
    progressTaskFailed() {
        this.updateProgress.tasksFailed++;
        this.progressRefresh();
    }
    progressRefresh() {
        this.emit("update.progress", Math.round(this.updateProgress.tasksDone * 100 / this.updateProgress.tasksPending));
    }

    /**
     * Restore all data from file
     */
    load() {
        let storageFile = this.getFile();
        // Read the data from file
        if (!fs.existsSync(storageFile)) {
            // Cache file does not exist! Initialize empty data object.
            return;
        }
        let cacheContent = fs.readFileSync(storageFile);
        this.loadFromJSON( cacheContent.toString() );
    }

    /**
     * Save all data to file
     */
    save() {
        // Sort hero names alphabetically
        for (let language in this.heroes.name) {
            let heroSort = [];
            for (let heroId in this.heroes.name[language]) {
                heroSort.push([heroId, this.heroes.name[language][heroId]]);
            }
            heroSort.sort(function(a, b) {
                if(a[1] < b[1]) { return -1; }
                if(a[1] > b[1]) { return 1; }
                return 0;
            });
            this.heroes.name[language] = {};
            for (let i = 0; i < heroSort.length; i++) {
                this.heroes.name[language][ heroSort[i][0] ] = heroSort[i][1];
            }
        }
        // Create cache directory if it does not exist
        let storageDir = path.join(this.plugin.path, "data");
        if (!fs.existsSync( storageDir )) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        // Write specific type into cache
        let storageFile = this.getFile();
        fs.writeFileSync( storageFile, JSON.stringify(this) );
    }

}

module.exports = HotsGameData;
