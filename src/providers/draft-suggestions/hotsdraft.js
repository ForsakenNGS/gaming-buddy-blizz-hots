// Nodejs dependencies
const request = require('request');
const cheerio = require('cheerio');

// Local classes
const HotsDraftSuggestions = require('../../hots/draft-suggestions.js');

class HeroesCountersProvider extends HotsDraftSuggestions {

    constructor(plugin) {
        super(plugin);
        this.heroesByName = {};
        this.heroesById = {};
        this.maps = {};
        this.picksBlue = [];
        this.picksRed = [];
        this.bans = [];
        this.activeMap = "";
        this.targetRole = "";
        this.suggestions = {};
        this.suggestionsForm = "";
        this.updateActive = false;
        this.updatePending = false;
    }
    addMap(id, name) {
        this.maps[name.toUpperCase()] = {
            id: id, name: name
        };
    }
    addHero(id, name, role, image) {
        let hero = {
            id: id, name: name, role: role, image: image
        }
        this.heroesByName[name.toUpperCase()] = hero;
        this.heroesById[id] = hero;
    }
    loadCoreData(response) {
        let self = this;
        let page = cheerio.load(response);
        // Load maps
        page('#map option').each(function() {
            let map = page(this);
            if (map.attr("value") > 0) {
                self.addMap( map.attr("value"), map.text() );
            }
        });
        // Load heroesByName
        page("#banned option").each(function() {
            let hero = page(this);
            self.addHero( hero.attr("value"), hero.text() );
        });
    }
    loadPickData(response) {
        if ((typeof response == "undefined") || !response.valid || (typeof response.scores == "undefined")) {
            console.error("HotsDraft Update failed: "+response);
            this.suggestionsForm = null;
            if (this.updatePending) {
                this.update();
            }
            return;
        }
        // Add images
        for (let i = 0; i < response.scores.length; i++) {
            response.scores[i].heroImage = this.plugin.gameData.getHeroImage(response.scores[i].label, "en-us");
        }
        // Store as result
        this.suggestions.picks = response.scores;
    }
    loadBanData(response) {
        if ((typeof response == "undefined") || !response.valid || (typeof response.scores == "undefined")) {
            console.error("HotsDraft Update failed: "+response);
            this.suggestionsForm = null;
            if (this.updatePending) {
                this.update();
            }
            return;
        }
        // Add images
        for (let i = 0; i < response.scores.length; i++) {
            response.scores[i].heroImage = this.plugin.gameData.getHeroImage(response.scores[i].label, "en-us");
        }
        // Store as result
        this.suggestions.bans = response.scores;
    }
    getHeroByName(name) {
        name = this.plugin.gameData.getHeroNameTranslation(name, "en-us");
        switch (name) {
            case "LÚCIO":
                name = "LUCIO";
        }
        if (this.heroesByName.hasOwnProperty(name)) {
            return this.heroesByName[name];
        } else {
            return null;
        }
    }
    getHeroById(id) {
        return this.heroesById[id];
    }
    getTemplate() {
        return "@forsaken87-gaming-buddy-blizz-hots::providers/hotsdraft.twig";
    }
    getTemplateData() {
        return {
            suggestions: this.getSuggestions(),
            targetRole: this.targetRole
        };
    }
    getSuggestions() {
        return this.suggestions;
    }
    getTargetRole() {
        return this.targetRole;
    }
    handleGuiAction(parameters) {
        switch (parameters.shift()) {
            case "setTargetRole":
                this.setTargetRole(...parameters);
                break;
        }
    }
    setTargetRole(role) {
        this.targetRole = role;
        this.update();
    }
    init() {
        this.updateActive = true;
        let url = "https://hotsdraft.com/draft/";
        return new Promise((resolve, reject) => {
            request({
                'method': 'GET',
                'uri': url,
                'jar': true
            }, (error, response, body) => {
                this.updateActive = false;
                if (error || (typeof response === "undefined")) {
                    reject(error);
                    return;
                }
                if (response.statusCode !== 200) {
                    reject('Invalid status code <' + response.statusCode + '>');
                    return;
                }
                this.loadCoreData(body);
                resolve(true);
            });
        });
    }
    update() {
        if (this.updateActive) {
            this.updatePending = true;
            return;
        }
        this.updatePending = false;
        this.updateActive = true;
        // Map
        let mapNameEn = this.plugin.gameData.getMapNameTranslation( this.plugin.draft.map, "en-us" );
        this.activeMap = "";
        if (this.maps.hasOwnProperty(mapNameEn)) {
            this.activeMap = this.maps[mapNameEn].id;
        }
        // Bans
        this.bans = [];
        // Player team
        this.picksBlue = [];
        let teamBlue = this.plugin.draft.teams.blue;
        if (teamBlue !== null) {
            let bansBlue = teamBlue.getBans();
            for (let i = 0; i < bansBlue.length; i++) {
                if ((bansBlue[i] === "???") || (bansBlue[i] === null)) {
                    continue;
                }
                let hero = this.getHeroByName( bansBlue[i] );
                if (hero !== null) {
                    this.bans.push(hero.id);
                } else {
                    console.error("Hero not found: "+bansBlue[i]);
                }
            }
            let playersBlue = teamBlue.getPlayers();
            for (let i = 0; i < playersBlue.length; i++) {
                if (!playersBlue[i].isLocked()) {
                    continue;
                }
                let hero = this.getHeroByName( playersBlue[i].getCharacter() );
                if (hero !== null) {
                    this.picksBlue.push(hero.id);
                } else {
                    console.error("Hero not found: "+playersBlue[i].getCharacter());
                }
            }
        }
        // Enemy team
        this.picksRed = [];
        let teamRed = this.plugin.draft.teams.red;
        if (teamRed !== null) {
            let bansRed = teamRed.getBans();
            for (let i = 0; i < bansRed.length; i++) {
                if ((bansRed[i] === "???") || (bansRed[i] === null)) {
                    continue;
                }
                let hero = this.getHeroByName( bansRed[i] );
                if (hero !== null) {
                    this.bans.push(hero.id);
                } else {
                    console.error("Hero not found: "+bansRed[i]);
                }
            }
            let playersRed = teamRed.getPlayers();
            for (let i = 0; i < playersRed.length; i++) {
                if (!playersRed[i].isLocked()) {
                    continue;
                }
                let hero = this.getHeroByName( playersRed[i].getCharacter() );
                if (hero !== null) {
                    this.picksRed.push(hero.id);
                } else {
                    console.error("Hero not found: "+playersRed[i].getCharacter());
                }
            }
        }
        // Send request
        let formData = {
            map: this.activeMap,
            banned: this.bans,
            allies: this.picksBlue,
            enemies: this.picksRed,
            league: 0,
            role: this.targetRole
        };
        let formJson = JSON.stringify(formData);
        if (formJson === this.suggestionsForm) {
            // Only update if there were actual changes
            this.updateActive = false;
            return true;
        }
        this.suggestionsForm = formJson;
        let formDataBans = Object.assign({}, formData, { banlist: 1, enemies: formData.allies, allies: formData.enemies });
        let requests = [
            this.updateRequest(formData),
            this.updateRequest(formDataBans)
        ];
        return Promise.all(requests).then((result) => {
            this.suggestions = { picks: [], bans: [] };
            this.loadPickData(result[0]);
            this.loadBanData(result[1]);
            this.emit("update.done");
            if (this.updatePending) {
                return this.update();
            } else {
                return true;
            }
        });
    }
    updateRequest(formData) {
        return new Promise((resolve, reject) => {
            request({
                'method': 'POST',
                'uri': 'https://hotsdraft.com/draft/list/',
                'form': formData,
                'jar': true,
                'json': true
            }, (error, response, body) => {
                this.updateActive = false;
                if (error || (typeof response === "undefined")) {
                    reject(error);
                    return;
                }
                if (response.statusCode !== 200) {
                    reject('Invalid status code <' + response.statusCode + '>');
                    return;
                }
                resolve(body);
            });
        });
    }
};

module.exports = HeroesCountersProvider;
