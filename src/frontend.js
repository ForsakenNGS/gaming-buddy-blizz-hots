// External classes
const GamingBuddyPluginFrontend = require("@forsaken87/gaming-buddy-plugins").PluginFrontend;

// Local classe
const HotsGameData = require("./frontend/game-data.js");

class BlizzHotsFrontend extends GamingBuddyPluginFrontend {

  constructor(gui, pluginName, pluginDirectory, pluginConfig) {
    super(gui, pluginName, pluginDirectory, pluginConfig);
    this.draft = {};
    this.gameData = new HotsGameData(this);
    this.draftProvider = null;
    this.talentProvider = null;
  }

  /**
   * Get the plugin title for the frontend
   * @returns {string}
   */
  getTitle() {
    return "Heroes of the Storm";
  }

  /**
   * Get the data for a specific player
   * @param team
   * @param index
   * @returns {null|*}
   */
  getPlayer(team, index) {
    if (!this.draft.hasOwnProperty("teams") || !this.draft.teams.hasOwnProperty(team) || !this.draft.teams[team].hasOwnProperty("players")) {
      return null;
    }
    return this.draft.teams[team].players[index];
  }

  /**
   * Handle message from the backend
   * @param type
   * @param parameters
   */
  handleMessage(type, parameters) {
    switch (type) {
      case "draft":
        this.draft = parameters[0];
        this.setPage("draft");
        break;
      case "draft.map":
        let mapName = parameters[0];
        this.draft.map = mapName;
        jQuery(".hots-draft-map").guiElement("render");
        break;
      case "draft.ban":
        let ban = parameters[0];
        this.draft.teams[ ban.team ].bans[ ban.index ] = ban.hero;
        if (ban.locked) {
          this.draft.teams[ ban.team ].bansLocked = Math.max(this.draft.teams[ ban.team ].bansLocked, ban.index);
        } else {
          this.draft.teams[ ban.team ].bansLocked = Math.min(this.draft.teams[ ban.team ].bansLocked, ban.index);
        }
        this.draft.teams[ ban.team ].banImageData[ ban.index ] = ban.heroImage;
        jQuery(".hots-draft-ban[data-team=\""+ban.team+"\"][data-index=\""+ban.index+"\"").guiElement("render");
        break;
      case "draft.player":
        let player = parameters[0];
        this.draft.teams[ player.team ].players[ player.index ] = player;
        jQuery(".hots-draft-player[data-team=\""+player.team+"\"][data-index=\""+player.index+"\"").guiElement("render");
        break;
      case "draft.provider.change":
        this.draftProvider = parameters[0];
        jQuery(".hots-draft-helper").guiElement("render");
        break;
      case "talent.provider.change":
        this.talentProvider = parameters[0];
        jQuery(".hots-talent-helper").guiElement("render");
        break;
      case "gameData":
        this.gameData.loadFromJSON(parameters[0]);
        break;
      default:
        super.handleMessage(type, parameters);
        break;
    }
  }

  /**
   * Save an unknown ban image
   * @param heroId
   * @param imageData
   */
  saveHeroBanImage(heroId, imageData) {
    this.sendMessage("ban.learn", heroId, imageData);
  }

  saveHeroCorrection(heroNameFailed, heroId) {
    this.sendMessage("hero.learn", heroNameFailed, heroId);
  }

}

module.exports = BlizzHotsFrontend;