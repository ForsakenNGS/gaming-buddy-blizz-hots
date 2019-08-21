// Nodejs dependencies
const EventEmitter = require('events');

const HotsPlayer = require('./player.js');

class HotsTeam extends EventEmitter {

  constructor(color) {
    super();
    this.color = color;
    this.bans = [null, null, null];
    this.bansLocked = 0;
    this.banImageData = [null, null, null];
    this.players = [];
    // Add players and bind events
    let self = this;
    for (let i = 0; i < 5; i++) {
      let player = new HotsPlayer(i, this);
      player.on("change", function() {
        self.emit("player.update", this);
      });
      this.players.push(player);
    }
  }

  /**
   * Returns the draft data in a json serializable form
   * @returns {object}
   */
  toJSON() {
    let banImagesEncoded = [];
    for (let i = 0; i < 3; i++) {
      banImagesEncoded.push( this.banImageData[i] !== null ? this.banImageData[i].toString("base64") : null );
    }
    return {
      color: this.color,
      bans: this.bans,
      bansLocked: this.bansLocked,
      banImageData: banImagesEncoded,
      players: this.players
    };
  }

  addBan(index, hero) {
    if (this.bans[index] !== hero) {
      this.bans[index] = hero;
      this.emit("ban.update", index);
    }
  }

  addBanImageData(index, imageData) {
    if (this.banImageData[index] !== imageData) {
      this.banImageData[index] = imageData;
      this.emit("ban.update", index);
    }
  }

  getColor() {
    return this.color;
  }

  getBans() {
    return this.bans;
  }

  getBansLocked() {
    return this.bansLocked;
  }

  getBanHero(index) {
    return this.bans[index];
  }

  getBanImages() {
    return this.banImageData;
  }

  getBanImageData(index) {
    return this.banImageData[index];
  }

  /**
   * @param index
   * @returns {HotsPlayer|null}
   */
  getPlayer(index) {
    if (index >= this.players.length) {
      return null;
    }
    return this.players[index];
  }

  getPlayers() {
    return this.players;
  }

  setColor(color) {
    this.color = color;
  }

  setBansLocked(bansLocked) {
    if (this.bansLocked !== bansLocked) {
      let bansLockedBefore = this.bansLocked;
      this.bansLocked = bansLocked;
      for (let i = bansLockedBefore; i < bansLocked; i++) {
        this.emit("ban.update", i);
      }
    }
  }

}

module.exports = HotsTeam;
