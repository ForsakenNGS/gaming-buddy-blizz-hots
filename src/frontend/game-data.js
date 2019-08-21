// Local classes
const HotsGameDataBase = require("../hots/game-data-base.js");

class HotsGameData extends HotsGameDataBase {

  /**
   * @param {BlizzHotsFrontend} pluginFrontend
   */
  constructor(pluginFrontend) {
    super(pluginFrontend);
  }

}

module.exports = HotsGameData;