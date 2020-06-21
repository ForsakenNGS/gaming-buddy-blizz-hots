// Nodejs dependencies
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');
const EventEmitter = require('events');

// Local classes
const HotsTeam = require('./team.js');
const ImageUtils = require('@forsaken87/gaming-buddy-plugins').ImageUtils;

class HotsDraft extends EventEmitter {

  /**
   * @param {BlizzHotsBackend} plugin
   */
  constructor(plugin) {
    super();
    this.plugin = plugin;
    // Current pick data
    this.map = null;
    this.teams = null;
    this.teamActive = null;
    // Layouts
    this.layoutDraft = this.plugin.loadLayoutFromXmlFile( path.resolve(plugin.getFilePath("layout", "draft.xml")) )[0];
    this.layoutBanCompare = this.layoutDraft.getById("draft.ban.compare.size").setScale(1, 1);
    // Ban images for comparing
    this.banImages = null;
    this.clear();
  }

  /**
   * Returns the draft data in a json serializable form
   * @returns {object}
   */
  toJSON() {
    return {
      map: this.map,
      teams: this.teams,
      teamActive: this.teamActive,
      banImages: this.banImages
    };
  }

  clear() {
    // Remove registered event listeners
    if (this.teams !== null) {
      this.teams.blue.removeAllListeners();
      this.teams.red.removeAllListeners();
    }
    // (Re)initialize fields
    this.map = null;
    this.teams = {
      "blue": new HotsTeam("blue"),
      "red": new HotsTeam("red")
    };
    // Register event listeners
    let self = this;
    // - Ban updates
    this.teams.blue.on("ban.update", function(banIndex) {
      self.emit("ban.update", this, banIndex);
      self.emit("change");
    });
    this.teams.red.on("ban.update", function(banIndex) {
      self.emit("ban.update", this, banIndex);
      self.emit("change");
    });
    // - Player updates
    this.teams.blue.on("player.update", function(player) {
      self.emit("player.update", this, player);
      self.emit("change");
    });
    this.teams.red.on("player.update", function(player) {
      self.emit("player.update", this, player);
      self.emit("change");
    });
    // Trigger change event
    this.emit("change");
  }

  loadBanImages() {
    return new Promise((resolve, reject) => {
      if (this.banImages !== null) {
        resolve(true);
        return;
      }
      this.banImages = {};
      // Create cache directory if it does not exist
      const directoryPathBase = this.plugin.getFilePath("data", "bans");
      if (!fs.existsSync(directoryPathBase)) {
        fs.mkdirSync(directoryPathBase, {recursive: true});
      }
      const directoryPathUser = path.join(this.plugin.getHomeDir(), "data", "bans");
      if (!fs.existsSync(directoryPathUser)) {
        fs.mkdirSync(directoryPathUser, {recursive: true});
      }
      // Load existing ban images
      this.loadBanImagesFromDir(directoryPathBase).then(() => {
        return this.loadBanImagesFromDir(directoryPathUser);
      }).then(() => {
        resolve(true);
      }).catch((error) => {
        reject(error);
      });
    });
  }

  loadBanImagesFromDir(directoryPath) {
    return new Promise((resolve, reject) => {
      fs.readdir(directoryPath, (errorMessage, files) => {
        if (errorMessage) {
          reject(new Error('Unable to scan directory: ' + errorMessage));
          return;
        }
        let loadPromises = [];
        files.forEach((file) => {
          let match = file.match(/^(.+)\.png$/);
          if (match) {
            // Load image
            let heroId = match[1];
            loadPromises.push(
              /**
               * @var {Jimp} image
               */
              Jimp.read(directoryPath + "/" + file).then(async (image) => {
                this.banImages[heroId] = image.resize(this.layoutBanCompare.bounds.computed.width, this.layoutBanCompare.bounds.computed.height).pHash();
              })
            );
          }
        });
        if (loadPromises.length === 0) {
          resolve(true);
        } else {
          Promise.all(loadPromises).then(() => {
            resolve(true);
          }).catch((error) => {
            reject(error);
          });
        }
      });
    });
  }

  saveHeroBanImage(heroId, banImageBase64) {
    if (!this.banImages.hasOwnProperty(heroId)) {
      let buffer = Buffer.from(banImageBase64.substr(banImageBase64.indexOf("base64,") + 7), 'base64');
      Jimp.read(buffer).then((image) => {
        let banHeroFile = path.join(this.plugin.getHomeDir(), "data", "bans", heroId + ".png");
        image.write(banHeroFile);
        this.banImages[heroId] = image.resize(this.layoutBanCompare.bounds.computed.width, this.layoutBanCompare.bounds.computed.height).pHash();
      });
    }
  }

  update() {
    this.plugin.debugLayoutsClear();
    return new Promise((resolve, reject) => {
      let window = this.plugin.app.getWindowActive();
      this.layoutDraft.setScale(window.size.width, window.size.height);
      this.loadBanImages().then(() => {
        // Update top part (map name, pick counter/indicator and bans)
        return this.updateTop();
      }).then((draftDetected) => {
        if (!draftDetected) {
          // No draft detected
          return Promise.resolve(false);
        }
        // Update teams
        let updateTeams = [
          this.updateTeam("blue"),
          this.updateTeam("red")
        ];
        return Promise.all(updateTeams).then(() => {
          return Promise.resolve(true);
        });
      }).then((draftDetected) => {
        this.plugin.debugStatus("Detection done!");
        this.plugin.debugLayoutsDone();
        resolve(draftDetected);
      }).catch((error) => {
        reject(error);
      });
    });
  }

  updateTop() {
    this.plugin.debugStatus("Detecting map/bans ...");
    // Apply layout "draft.top"
    return this.layoutDraft.getById("draft.top").applyFromScreen(this.plugin.app).then((results) => {
      // Debug data
      this.plugin.debugLayoutsAdd(results);
      // Promises to finish
      for (let i = 0; i < results.length; i++) {
        /** @var {Layout} resultLayout */
        let resultLayout = results[i][0];
        /** @var {Jimp} resultImage */
        let resultImage = results[i][1];
        switch (resultLayout.id) {
          case "draft.top.mapName":
            let detectedMap = this.plugin.gameData.fixMapName(resultLayout.extra.ocrResult.text);
            if ((detectedMap !== "") && (this.plugin.gameData.mapExists(detectedMap))) {
              if (this.map !== detectedMap) {
                this.clear();
                this.emit("start");
                this.map = detectedMap;
                this.emit("map.update", this.map);
              }
            }
            break;
          case "draft.top.pickTimer.top":
            // Pick timer
            if (ImageUtils.imageContainsColor(resultImage, resultLayout.getColorsById("timer.blue"))) {
              this.teamActive = "blue";
            } else if (ImageUtils.imageContainsColor(resultImage, resultLayout.getColorsById("timer.red"))) {
              this.teamActive = "red";
            } else if (ImageUtils.imageContainsColor(resultImage, resultLayout.getColorsById("timer.ban"))) {
              this.teamActive = "ban";
            } else {
              this.teamActive = null;
            }
            break;
        }
      }
      if ((this.map !== null) && (this.teamActive !== null)) {
        // Both map name and pick counter/indicator found
        return Promise.all([
          this.updateBans(results[0][0], results[0][1], this.teams.blue),
          this.updateBans(results[0][0], results[0][1], this.teams.red)
        ]).then(() => {
          return Promise.resolve(true);
        });
      } else {
        return Promise.resolve(false);
      }
    });
  }

  /**
   * Update the bans
   * @param {Layout} layoutTop
   * @param {Jimp} imageTop
   * @param {HotsTeam} team
   */
  updateBans(layoutTop, imageTop, team) {
    let layoutBans = layoutTop.getById("draft.top.bans."+team.color);
    return layoutBans.apply( layoutBans.cropParentImage(imageTop) ).then((results) => {
      // Debug data
      this.plugin.debugLayoutsAdd(results);
      // Promises to finish
      let promises = [ Promise.resolve(true) ];
      for (let i = 0; i < results.length; i++) {
        /** @var {Layout} resultLayout */
        let resultLayout = results[i][0];
        /** @var {Jimp} resultImage */
        let resultImage = results[i][1];
        switch (resultLayout.id) {
          case "draft.top.bans.blue.0":
          case "draft.top.bans.blue.1":
          case "draft.top.bans.blue.2":
          case "draft.top.bans.red.0":
          case "draft.top.bans.red.1":
          case "draft.top.bans.red.2":
            if (this.teamActive !== "ban") {
              // Detect bans
              let banMatch = resultLayout.id.match(/^draft\.top\.bans\.([^.]+)\.([0-9]+)$/);
              if (banMatch) {
                promises.push( this.updateBan(this.teams[banMatch[1]], parseInt(banMatch[2]), resultImage) );
              }
            }
            break;
        }
      }
      return Promise.all(promises);
    });
  }

  /**
   * @param {HotsTeam} team
   * @param {number} index
   * @param {Jimp} image
   * @returns {Promise<unknown>}
   */
  updateBan(team, index, image) {
    return new Promise((resolve, reject) => {
      let bansLocked = team.getBansLocked();
      if (bansLocked > index) {
        // Ban already locked, do not update again.
        console.log("Ban #"+(index+1)+" skipped! (Ban already locked)");
        resolve();
        return;
      }
      console.log("Ban #"+(index+1)+" updating...");
      let imageCompare = image.clone().resize(this.layoutBanCompare.bounds.computed.width, this.layoutBanCompare.bounds.computed.height);
      let matchBestHero = null;
      let matchBestValue = 0.15;
      for (let heroId in this.banImages) {
        let heroValue = imageCompare.distanceFromHash(this.banImages[heroId]);
        if (heroValue < matchBestValue) {
          matchBestHero = heroId;
          matchBestValue = heroValue;
        }
      }
      if (matchBestHero !== null) {
        if (this.plugin.app.getConfigValue("debug")) {
          console.log("Ban #"+(index+1)+" "+team.color+": "+matchBestHero+" @ "+matchBestValue);
        }
        team.addBan(index, this.plugin.gameData.getHeroName(matchBestHero));
        if (bansLocked === index) {
          team.setBansLocked(index + 1);
        }
      } else {
        team.addBan(index, "???");
        image.getBufferAsync(Jimp.MIME_PNG).then((buffer) => {
          team.addBanImageData(index, buffer);
        });
      }
      resolve();
    });
  }

  updateTeam(color) {
    this.plugin.debugStatus("Detecting players ...");
    // Apply layout "draft.picks.blue"
    return this.layoutDraft.getById("draft.picks."+color).applyFromScreen(this.plugin.app).then((results) => {
      // Debug data
      this.plugin.debugLayoutsAdd(results);
      // Team status
      let team = this.teams[color];
      let teamOther = (color === "blue" ? "red" : "blue");
      let teamStatus = (this.teamActive === color ? "active" : (this.teamActive === teamOther ? "inactive" : null));
      // Dump result images
      let playerPicks = [];
      for (let i = 0; i < results.length; i++) {
        let resultLayout = results[i][0];
        let resultImage = results[i][1];
        switch (resultLayout.id) {
          case "draft.picks.blue.0.heroName":
          case "draft.picks.blue.1.heroName":
          case "draft.picks.blue.2.heroName":
          case "draft.picks.blue.3.heroName":
          case "draft.picks.blue.4.heroName":
          case "draft.picks.red.0.heroName":
          case "draft.picks.red.1.heroName":
          case "draft.picks.red.2.heroName":
          case "draft.picks.red.3.heroName":
          case "draft.picks.red.4.heroName": {
            let playerIndex = resultLayout.id.match(/^draft\.picks\.([^.]+)\.([0-9]+)\.heroName$/)[2];
            let player = team.getPlayer(playerIndex);
            /** @var {Layout|null} pickHeroName */
            let pickHeroName = null;
            let pickHeroLocked = false;
            if (teamStatus !== null) {
              let lockedMatch = ImageUtils.imageBorderColor(resultImage, resultLayout.getColorsById("hero.background.locked." + teamStatus), 5, 5);
              if (lockedMatch > 200) {
                // Hero locked
                pickHeroName = resultLayout.getById(resultLayout.id + ".locked." + teamStatus);
                pickHeroLocked = true;
              } else if (teamStatus === "active") {
                if (ImageUtils.imageContainsColor(resultImage, resultLayout.getColorsById("hero.name.active.picking"))) {
                  pickHeroName = resultLayout.getById(resultLayout.id + "." + teamStatus + ".picking");
                } else {
                  pickHeroName = resultLayout.getById(resultLayout.id + "." + teamStatus);
                }
              } else {
                pickHeroName = resultLayout.getById(resultLayout.id + "." + teamStatus);
              }
            }
            if ((pickHeroName !== null) && !player.isLocked()) {
              playerPicks.push(
                pickHeroName.apply(pickHeroName.cropParentImage(resultImage)).then((result) => {
                  this.plugin.debugLayoutsAdd(result);
                  let heroName = this.plugin.gameData.correctHeroName(result[0][0].extra.ocrResult.text);
                  player.setCharacter(heroName, !this.plugin.gameData.heroExists(heroName));
                  player.setImageHeroName(result[0][1]);
                  player.setLocked(pickHeroLocked);
                  return Promise.resolve(result[0])
                })
              );
            } else {
              playerPicks.push(Promise.resolve([null, null]));
            }
            break;
          }
          case "draft.picks.blue.0.playerName":
          case "draft.picks.blue.1.playerName":
          case "draft.picks.blue.2.playerName":
          case "draft.picks.blue.3.playerName":
          case "draft.picks.blue.4.playerName":
          case "draft.picks.red.0.playerName":
          case "draft.picks.red.1.playerName":
          case "draft.picks.red.2.playerName":
          case "draft.picks.red.3.playerName":
          case "draft.picks.red.4.playerName": {
            let playerIndex = resultLayout.id.match(/^draft\.picks\.([^.]+)\.([0-9]+)\.playerName$/)[2];
            let player = team.getPlayer(playerIndex);
            if ((this.teamActive === color) && !player.isNameFinal()) {
              let pickActive = resultLayout.getById(resultLayout.id + ".active");
              playerPicks.push(
                pickActive.apply(pickActive.cropParentImage(resultImage)).then((result) => {
                  this.plugin.debugLayoutsAdd(result);
                  let playerName = result[0][0].extra.ocrResult.text.trim();
                  if (playerName != "") {
                    player.setName(playerName, false);
                    player.setImagePlayerName(result[0][1]);
                    this.plugin.gameData.updatePlayerRecentPicks(player);
                  }
                  return Promise.resolve(result[0])
                })
              );
            } else if ((this.teamActive === teamOther) && !player.isNameFinal()) {
              let pickInactive = resultLayout.getById(resultLayout.id + ".inactive");
              playerPicks.push(
                pickInactive.apply(pickInactive.cropParentImage(resultImage)).then((result) => {
                  let playerName = result[0][0].extra.ocrResult.text.trim();
                  this.plugin.debugLayoutsAdd(result);
                  if (playerName != "") {
                    player.setName(playerName, true);
                    player.setImagePlayerName(result[0][1]);
                    this.plugin.gameData.updatePlayerRecentPicks(player);
                  }
                  return Promise.resolve(result[0])
                })
              );
            } else {
              playerPicks.push(Promise.resolve([null, null]));
            }
            break;
          }
        }
      }
      return Promise.all(playerPicks);
    });
  }

  getTeam(color) {
    return this.teams[color];
  }

  getTeams() {
    return this.teams;
  }

  getPlayers() {
    return [
      ...this.teams.blue.players, ...this.teams.red.players
    ];
  }

}

module.exports = HotsDraft;
