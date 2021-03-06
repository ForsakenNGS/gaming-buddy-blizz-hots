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
        this.sortField = {
            "blue": "winrate",
            "red": "winrate"
        };
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
        page('select[name="maps"] option').each(function() {
            let map = page(this);
            if (map.attr("value") > 0) {
                self.addMap( map.attr("value"), map.text() );
            }
        });
        // Load heroesByName
        page(".teampickerlist-hero").each(function() {
            let hero = page(this);
            self.addHero(
                hero.attr("data-hero"), hero.attr("data-heroname"),
                hero.attr("data-role"), hero.find("img").attr("src")
            );
        });
    }
    loadUpdateData(response) {
        if (response.error || (typeof response.suggestions == "undefined")) {
            console.error("HeroesCounters Update failed: "+response.error);
            this.suggestionsForm = null;
            if (this.updatePending) {
                this.update();
            }
            return;
        }
        this.suggestions = {
            friend: [],
            enemy: [],
            tips: (response.suggestions.hasOwnProperty("tips") ? response.suggestions.tips : [])
        };
        for (let id in response.suggestions.friend) {
            response.suggestions.friend[id].id = id;
            this.suggestions.friend.push( response.suggestions.friend[id] );
        }
        for (let id in response.suggestions.enemy) {
            response.suggestions.enemy[id].id = id;
            this.suggestions.enemy.push( response.suggestions.enemy[id] );
        }
        this.sortSuggestions("blue");
        this.sortSuggestions("red");
        this.emit("update.done");
        if (this.updatePending) {
            this.update();
        }
    }
    getHeroByName(name) {
        switch (name) {
            case "E.T.C.":
                name = "ETC";
        }
        name = this.plugin.gameData.getHeroNameTranslation(name, "en-us");
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
        return "@forsaken87-gaming-buddy-blizz-hots::providers/heroescounters.twig";
    }
    getTemplateData() {
        return {
            suggestions: this.getSuggestions(),
            sortField: this.sortField,
            heroesById: this.heroesById,
            heroesByName: this.heroesByName
        };
    }
    getSuggestions() {
        return this.suggestions;
    }
    getSortField(team) {
        return this.sortField[team];
    }
    handleGuiAction(parameters) {
        switch (parameters.shift()) {
            case "sortBy":
                this.sortBy(...parameters);
                break;
        }
    }
    sortBy(team, field) {
        this.sortField[team] = field;
        this.sortSuggestions(team);
        this.emit("change");
    }
    sortSuggestions(team) {
        let suggestionField = null;
        switch (team) {
            case "blue":
                suggestionField = "friend";
                break;
            case "red":
                suggestionField = "enemy";
                break;
            default:
                throw new Error("Unknown team: "+team);
                break;
        }
        if (this.suggestions.hasOwnProperty(suggestionField)) {
            let sortField = this.sortField[team];
            this.suggestions[suggestionField].sort((a, b) => {
                return (b[sortField] - a[sortField]);
            });
            this.suggestions[suggestionField].map((entry, index) => {
                entry.order = index;
            });
        }
    }
    init() {
        this.updateActive = true;
        let url = "https://www.heroescounters.com/teampicker";
        return new Promise((resolve, reject) => {
            request({
                'method': 'GET',
                'uri': url
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
            return Promise.resolve();
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
        let url = "https://www.heroescounters.com/teampicker/calculate"+
            "?playerteam="+this.picksBlue.join(",")+
            "&enemyteam="+this.picksRed.join(",")+
            "&bans="+this.bans.join(",")+
            "&map="+this.activeMap;
        if (url === this.suggestionsForm) {
            // Only update if there were actual changes
            this.updateActive = false;
            return Promise.resolve(true);
        }
        this.suggestionsForm = url;
        return new Promise((resolve, reject) => {
            request({
                'method': 'GET',
                'uri': url,
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
                this.loadUpdateData(body);
                resolve(true);
            });
        });
    }

};

module.exports = HeroesCountersProvider;
