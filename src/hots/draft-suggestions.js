// Nodejs dependencies
const EventEmitter = require('events');

class DraftSuggestions extends EventEmitter {

    /**
     * @param {BlizzHotsBackend} plugin
     */
    constructor(plugin) {
        super();
        this.plugin = plugin;
        // Update suggestions when the draft changes
        let self = this;
        let selfUpdate = () => {
            self.update(this).then(() => {
                self.emit("change");
            });
        }
        // Map, ban or player changed
        plugin.draft.on("map.update", selfUpdate);
        plugin.draft.on("ban.update", selfUpdate);
        plugin.draft.on("player.update", selfUpdate);
    }
    detach() {
        this.removeAllListeners("change");
    }
    init() {
        throw new Error('Function "init" not implemented for current draft provider!');
    }
    update() {
        return Promise.reject(new Error('Function "update" not implemented for current draft provider!'));
    }
    handleGuiAction(parameters) {
        throw new Error('Function "handleGuiAction" not implemented for current draft provider!');
    }
    getTemplate() {
        throw new Error('Function "getTemplate" not implemented for current draft provider!');
    }
    getTemplateData() {
        throw new Error('Function "getTemplateData" not implemented for current draft provider!');
    }
}

module.exports = DraftSuggestions;
