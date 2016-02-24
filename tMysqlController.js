var mysql = require('mysql');

// todo: add support for  n:m ralations including middle Properties (could be realized by 2 simple Fetch methods)
// todo: paging, for findWhere, and getBy

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
    return function (err, data) {
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
            var val = {};
            for (var i in obj) {
                if (obj.hasOwnProperty(i) && typeof obj[i] !== 'object') {
                    val[i] = obj[i];
                }
            }

            var sql = 'INSERT INTO ' + tableName + ' SET ?';
            db.query(sql, val, function (err, result) {
                if (!err) {
                    obj.id = result.insertId;
                } else {
                    console.log(err);
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
            db.query(sql + where + limit, values, first(callback), connection);
        },

        remove: function (tableName, idKey, objs, callback, connection) {
            if (!Array.isArray(objs)) { objs = [objs]; }
            if (!Array.isArray(idKey)) { idKey = [idKey]; }
            var sql = 'DELETE FROM ' + tableName + ' WHERE ';
            if (idKey.length === 1) {
                var key = idKey[0];
                var ids = objs.map(function (obj) {
                    if (typeof obj == "object") {
                        return obj[key];
                    } else {
                        return obj;
                    }
                });
                sql += key + ' IN (?);'
                db.query(sql, [ids], callback, connection);
            } else {
                var values = [];
                var whereBuilder = [];
                for (var i in objs) {
                    var obj = objs[i];
                    var clouseBuilder = []
                    idKey.forEach(function (key) {
                        clouseBuilder.push('?? = ?');
                        values.push(i);
                        values.push(obj[i]);
                    });
                    whereBuilder.puch('(' + clouseBuilder.join(' AND ') + ')')
                }
                sql += whereBuilder.join('OR');
                db.query(sql, values, callback, connection);
            }
        },
        save:function(tableName, primaries, objs, callback,connection){
            if(!Array.isArray(objs)){objs = [objs];}
            var number = objs.length;
            var count = 0;
            var errors = [];
            objs.foreEach(function(obj){
                 db.saveOne(tableName,primaries, obj, function(err){
                     count++;
                     if(err){errors.push([obj,err]);}
                     if(count === number){
                         callback(errors.length ? errors : null);
                     }
                 },connection)
            });
        },
        saveOne: function (tableName, primaries, keys, callback, connection) {
            // primaries is optional parameter, default is 'id'
            if (typeof primaries == "function") {
                connection = callback;
                callback = primaries;
                primaries = ['id'];
            }
            // primaries can be one or more Keys
            if (!Array.isArray(primaries)) primaries = [primaries];

            var sql = 'UPDATE ' + tableName + ' SET ';
            var keybuilder = [];
            var params = [];
            for (var i in keys) {
                if (primaries.indexOf(i) === -1 && typeof keys[i] !== 'object') {
                    keybuilder.push(i + '=?');
                    params.push(keys[i]);
                }
            }
            sql += keybuilder.join(',');
            sql += ' WHERE '
            primaries.forEach(function (primary, index) {
                if (index) sql += ' AND ';
                sql += '?? = ?';
                params.push(primary);
                params.push(keys[primary]);
            });
            db.query(sql + ';', params, callback, connection);
        },

        prepareController: function (model) {
            var tableName = model.tableName;
            var IDKeys = [];

            model.db = db;

            model.insert = function (obj, callback, connection) {
                db.insert(tableName, obj, callback, connection);
            }
            model.save= function(objs, callback, connection){
                db.save(tableName,IDKeys,objs,callback, connection)
            };
            model.saveOne = function (obj, callback, connection) {
                db.saveOne(tableName, IDKeys, obj, callback, connection);
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
                db.remove(tableName, IDKeys, obj, callback, connection)
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
                        db.remove(tableName, name, value, callback, connection);
                    };
                    prepareFetchMethod(db, model, tableName, name, definition)
                    if (definition.primary) { IDKeys.push(name); }
                })(i, model.fields[i]);
            }
            if (!IDKeys.length) IDKeys.push('id');
            if (model.has) {
                for (var name in model.has) {
                    prepareFetchMethod(db, model, tableName, name, { mapTo: model.has[name] });
                }
            }
            return model;
        }
    };
    return db;
}

function prepareFetchMethod(db, model, tableName, name, definition) {
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
}
