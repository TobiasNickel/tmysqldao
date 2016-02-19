var mysql = require('mysql');

// add support for ralations

/**
 * makes sure, that poolconnections get released when they got committed or rollback
 */
var extendTransactionConnection = function (connection) {
    if (connection.rollback && !connection._OrgRollback && connection.commit && !connection._OrgCommit && connection.release) {
        connection._OrgRollback = connection.rollback;
        connection.rollback = function (callback) {
            connection._OrgRollback(function (err) {
                if (err) { callback(err); return; }
                connection.release();
                callback(null);
            });
        };

        connection._OrgCommit = connection.commit;
        connection.commit = function (callback) {
            connection._OrgCommit(function (err) {
                if (err) { callback(err); return; }
                connection.release();
                callback(null);
            });
        };
    }
    return connection;
};

function first(callback) {
    console.log('pack First callback', callback)
    return function (err, data) {
        console.log('get first;')
        if (err) {
            callback(err);
        } else {
            callback(null, data[0]);
        }
    }
}


module.exports = function (config) {
    var db = {
        pool: mysql.createPool(config),
        /**
         * query method, that can get a connection, to support transactions
         * you can follow a paradime where you have connection and callback as the last two params, and call query with both.
         * so your method can also run in a transaction.
         */
        query(sql, params, callback, connection) {
            if (typeof params == 'function') {
                connection = callback;
                callback = params;
                params = [];
            }
            if (!connection) connection = db.pool;
            connection.query(sql, params, callback);
        },
        beginTransaction(callback) {
            db.database.getConnection(function (err, connection) {
                if (err) { callback(err); return }
                connection.beginTransaction(function (err) {
                    if (err) { callback(err); return; }
                    callback(null, extendTransactionConnection(connection));
                });
            });
        },
        insert: function (tableName, obj, callback, connection) {
            var sql = 'INSERT INTO ' + tableName + ' SET ?';
            db.query(sql, obj, function (err, result) {
                if (!err) {
                    obj.id = result.insertId;
                } else {
                    console.log(err)
                }
                callback(err, result.insertId);
            }, connection);
        },

        getBy: function (tableName, fieldName, value, callback, connection) {
            var sql = 'SELECT * FROM ' + tableName + ' WHERE ' + fieldName + ' IN (?)';
            db.query(sql, [value], callback, connection);
        },

        getOneBy: function (tableName, fieldName, value, callback, connection) {
            var sql = 'SELECT * FROM ' + tableName + ' WHERE ' + fieldName + ' IN (?) LIMIT 0, 1;';
            db.query(sql, [value], first(callback), connection);
        },
        findWhere: function (tableName, obj, callback, connection) {
            var sql = 'SELECT * FROM ' + tableName + ' WHERE ';
            var where = '1 '
            var values = [];
            for (var i in obj) {
                where += ' AND ?? = ?';
                values.push(i);
                values.push(obj[i]);
            }
            db.query(sql + where, values, callback, connection);
        },
        findOneWhere: function (tableName, obj, callback, connection) {
            var sql = 'SELECT * FROM ' + tableName + ' WHERE ';
            var where = '1 '
            var values = [];
            for (var i in obj) {
                where += ' AND ?? = ?';
                values.push(i);
                values.push(obj[i]);
            }
            var limit = ' LIMIT 0,1;'
            console.log('USED THE findOneWhere')
            db.query(sql + where + limit, values, first(callback), connection);
        },

        removeBy: function (tableName, fieldName, value, callback, connection) {
            var sql = 'DELETE FROM ' + tableName + ' WHERE ' + fieldName + ' IN (?);'
            db.query(sql, [value], callback, connection);
        },
        remove: function (tableName, objs, callback, connection) {
            if (!Array.isArray(objs)) { objs = [objs]; }
            var ids = objs.map(function (obj) {
                if (typeof obj == "object") {
                    return obj.id;
                } else {
                    return obj;
                }
            });
            db.removeBy(tableName, 'id', ids, callback, connection);
        },

        saveOne: function (tableName, keys, callback, connection) {
            var sql = 'UPDATE ' + tableName + ' SET ';
            var keybuilder = [];
            var params = [];
            for (var i in keys) {
                if (i != 'id') {
                    keybuilder.push(i + '=?');
                    params.push(keys[i]);
                }
            }
            sql += keybuilder.join(',');
            sql += ' WHERE id = ?;';
            params.push(keys.id);
            db.query(sql, params, callback, connection);
        },

        prepareController: function (model) {
            var tableName = model.tableName;

            model.db = db;

            model.insert = function (obj, callback, connection) {
                db.insert(tableName, obj, callback, connection);
            }

            model.saveOne = function (keys, callback, connection) {
                db.saveOne(tableName, keys, callback, connection);
            };

            model.getAll = function (callback, connection) {
                db.query("SELECT * FROM ??;", [tableName], callback, connection);
            };

            model.findWhere = function (obj, callback, connection) {
                db.findWhere(tableName, obj, connection, callback);
            };
            model.findOneWhere = function (obj, callback, connection) {
                db.findOneWhere(tableName, obj, callback, connection);
            };

            model.remove = function (obj, callback, connection) {
                db.remove(tableName, obj, callback, connection)
            };

            for (var i in model.fields) {
                (function (name, definition) {
                    var addName = name[0].toUpperCase() + name.slice(1).toLowerCase();

                    model['getBy' + addName] = function (value, callback, connection) {
                        db.getBy(tableName, name, value, callback, connection);
                    };

                    model['getOneBy' + addName] = function (value, callback, connection) {
                        db.getOneBy(tableName, name, value, callback, connection);
                    };

                    model['removeBy' + addName] = function (value, callback, connection) {
                        db.removeBy(tableName, name, value, callback, connection);
                    };
                    if (definition.mapTo) {
                        model['fetch' + addName] = function (objs, callback, connection) {
                            if (!Array.isArray(objs)) { objs = [objs]; }
                            var objsByKey = {};
                            var keys = objs.map(function (obj) {
                                var key;
                                if (typeof obj == 'string') {
                                    key = obj;
                                    obj = {};
                                    obj[name] = key;
                                } else {
                                    key = obj[definition.mapTo.localField || name];
                                }
                                if (!objsByKey[key]) objsByKey[key] = [];
                                objsByKey[key].push(obj);
                                return key;
                            });
                            db.query(
                                "SELECT * FROM " + definition.mapTo.tableName + " WHERE " + (definition.mapTo.foreignKey || 'id') + ' IN (?)', [keys],
                                function (err, list) {
                                    if (err) { callback(err); return; }
                                    console.log('loaded USER', list)
                                    list.forEach(function (item) {
                                        var key = item[definition.mapTo.foreignKey]
                                        var objs = objsByKey[key];
                                        objs.forEach(function (obj) {
                                            if (definition.mapTo.multiple) {
                                                if (!obj['_' + name]) obj['_' + name] = []
                                                obj['_' + name].push(item);
                                            } else {
                                                obj['_' + name] = item;
                                            }
                                        });
                                    });
                                    callback(null, objs)
                                }, connection);
                        }
                    }
                })(i, model.fields[i]);
            }
            if (model.has) {
                for (var name in model.has) {
                    (function (name, definition,localField) {
                        var addName = name[0].toUpperCase() + name.slice(1).toLowerCase();
                        model['fetch' + addName] = function (objs, callback, connection) {
                            if (!Array.isArray(objs)) { objs = [objs]; }
                            var objsByKey = {};
                            var keys = objs.map(function (obj) {
                                var key;
                                if (typeof obj == 'string') {
                                    key = obj;
                                    obj = {};
                                    obj[name] = key;
                                } else {
                                    key = obj[definition.mapTo.localField || name];
                                }
                                if (!objsByKey[key]) objsByKey[key] = [];
                                objsByKey[key].push(obj);
                                return key;
                            });
                            db.query(
                                "SELECT * FROM " + definition.mapTo.tableName + " WHERE " + (definition.mapTo.foreignKey || 'id') + ' IN (?)', [keys],
                                function (err, list) {
                                    if (err) { callback(err); return; }
                                    list.forEach(function (item) {
                                        var key = item[definition.mapTo.foreignKey]
                                        var objs = objsByKey[key];
                                        objs.forEach(function (obj) {
                                            if (definition.mapTo.multiple) {
                                                if (!obj['_' + name]) obj['_' + name] = []
                                                obj['_' + name].push(item);
                                            } else {
                                                obj['_' + name] = item;
                                            }
                                        });
                                    });
                                    callback(null, objs)
                                }, connection);

                        }
                    })(name, {mapTo:model.has[name]});
                }
            }
            return model;
        }
    }

    return db;
}
