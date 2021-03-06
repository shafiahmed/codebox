define([
    "q",
    "underscore",
    "hr/hr",
    "core/backends/rpc",
    "models/addon",
    "utils/dialogs"
], function(Q, _, hr, rpc, Addon, dialogs) {
    var Addons = hr.Collection.extend({
        model: Addon,
        defaults: _.defaults({
            loader: "getInstalled",
            loaderArgs: [],
        }, hr.Collection.prototype.defaults),

        // Constructor
        initialize: function() {
            Addons.__super__.initialize.apply(this, arguments);

            this.resolved = {};
            this.provides = {};

            return this;
        },
        
        // Get installed addons
        getInstalled: function(options) {
            var that = this;
            
            options = _.defaults(options || {}, {});

            return rpc.execute("addons/list").then(function(data) {
                that.add(_.values(data));
            });
        },

        // Get by name
        getByName: function(name) {
            return this.find(function(addon) {
                return addon.get("name") == name;
            });
        },

        // Check addons is installed
        isInstalled: function(name) {
            return this.getByName(name) != null;
        },

        // Check addons is a default addon
        isDefault: function(name) {
            var m = this.getByName(name);
            if (m == null) return false;
            return m.get("default");
        },

        // Check is updated
        isUpdated: function(addon) {
            var m = this.getByName(addon.get("name"));
            if (!m) return true;
            return m.version() >= addon.version();
        },

        // Get addon state
        getState: function(name) {
            var m = this.getByName(name);
            if (m == null) return null;
            return m.get("state");
        },

        // Install an addon
        install: function(git) {
            var that = this;

            return rpc.execute("addons/install", {
                'git': git
            }).then(function(data) {
                that.reset([]);
                return that.getInstalled();
            });
        },
        uninstall: function(name) {
            var that = this;

            return rpc.execute("addons/uninstall", {
                'name': name
            }).then(function() {
                that.reset([]);
                return that.getInstalled();
            });
        },

        // Extract from engineer, order addons for loading
        checkCycles: function() {
            var that = this;
            var plugins = this.map(function(addon, index) {
                return {
                    name: addon.get("name"),
                    provides: addon.get("client.provides", []).concat(),
                    consumes: addon.get("client.consumes", []).concat(),
                    i: index
                };
            });

            var changed = true;
            var sorted = [];

            while(plugins.length && changed) {
                changed = false;

                plugins.concat().forEach(function(plugin) {
                    var consumes = plugin.consumes.concat();

                    var resolvedAll = true;
                    for (var i=0; i<consumes.length; i++) {
                        var service = consumes[i];
                        if (!that.resolved[service]) {
                            resolvedAll = false;
                        } else {
                            plugin.consumes.splice(plugin.consumes.indexOf(service), 1);
                        }
                    }

                    if (!resolvedAll)
                        return;

                    plugins.splice(plugins.indexOf(plugin), 1);
                    plugin.provides.forEach(function(service) {
                        that.resolved[service] = true;
                    });
                    sorted.push(that.models[plugin.i]);
                    changed = true;
                });
            }

            if (plugins.length) {
                var unresolved = {};
                plugins.forEach(function(plugin) {
                    delete plugin.config;
                    plugin.consumes.forEach(function(name) {
                        if (unresolved[name] == false)
                            return;
                        if (!unresolved[name])
                            unresolved[name] = [];
                        unresolved[name].push(plugin.name);
                    });
                    plugin.provides.forEach(function(name) {
                        unresolved[name] = false;
                    });
                });

                Object.keys(unresolved).forEach(function(name) {
                    if (unresolved[name] == false)
                        delete unresolved[name];
                });

                console.error("Could not resolve dependencies of these plugins:", plugins);
                console.error("Resolved services:", _.keys(that.resolved));
                console.error("Missing services:", unresolved);
                return Q.reject(new Error("Could not resolve dependencies"));
            }

            return Q(sorted);
        },

        // Load all this addons collection
        // similar loading to engineer
        loadAll: function() {
            var that = this;

            return this.checkCycles().then(function(addons) {
                return _.reduce(addons, function(d, addon) {
                    return d.then(function() {
                        return addon.load({}, _.pick(that.provides, addon.get("client.consumes", []))).fail(function(err) {
                            err.addon = addon;
                            return Q.reject(err);
                        }).then(function(provides) {
                            _.extend(that.provides, provides || {});
                        }, function(err) {
                            return dialogs.alert("Error with addon '"+addon.get("name")+"'", "<p>Error when initializing this addon. Please check addons states using the addons manager and reinstall this addon.</p><p>Error message:"+ (err.message || err) +"</p>");
                        }).then(function() {
                            return Q();
                        }, function() {
                            return Q();
                        });
                    })
                }, Q({}));
            });
        }
    });

    return Addons;
});