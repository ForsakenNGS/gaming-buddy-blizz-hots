// Nodejs dependencies
const EventEmitter = require('events');

class TalentSuggestions extends EventEmitter {

    /**
     * @param {BlizzHotsBackend} plugin
     */
    constructor(plugin) {
        super();
        this.plugin = plugin;
        // Update suggestions when the draft changes
        let self = this;
        this.plugin.on("game.start", function() {
            self.update(this).then(() => {
                self.emit("change");
            });
        });
        this.plugin.on("game.end", function() {
            self.update(this).then(() => {
                self.emit("change");
            });
        });
    }
    detach() {
        this.removeAllListeners("change");
    }
    init() {
        throw new Error('Function "init" not implemented for current talent provider!');
    }
    update() {
        throw new Error('Function "update" not implemented for current talent provider!');
    }
    handleGuiAction(parameters) {
        throw new Error('Function "handleGuiAction" not implemented for current talent provider!');
    }
    getTemplate() {
        throw new Error('Function "getTemplate" not implemented for current talent provider!');
    }
    getTemplateData() {
        throw new Error('Function "getTemplateData" not implemented for current talent provider!');
    }
}

module.exports = TalentSuggestions;
