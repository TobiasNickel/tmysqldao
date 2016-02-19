var mysql = require('mysql');
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


module.exports = function(config)
var db = {
    pool: mysql.createPool(config),
    /**
     * query method, that can get a connection, to support transactions
     * you can follow a paradime where you have connection and callback as the last two params, and call query with both.
     * so your method can also run in a transaction.
     */
    query: function (sql, params, connection, callback) {
        if (typeof params == 'function') {
            // no connection
            //normal request params is the callback
            callback = params;
            connection = db.pool;
            params = [];
        } else if (typeof connection == 'function') {
            callback = connection;
            if (typeof params.query == 'function') {
                // params is a connection
                connection = params;
                params = [];
            } else {
                //normal request
                connection = db.pool;
            }
        } else if (!connection) {
            connection = db.pool;
        }
        connection.query(sql, params, callback);
    },
    beginTransaction: function (callback) {
        db.database.getConnection(function (err, connection) {
            if (err) { callback(err); return }
            connection.beginTransaction(function (err) {
                if (err) { callback(err); return; }
                callback(null, extendTransactionConnection(connection));
            });
        });
    },
    insert: function (tableName, obj, callback) {
        var sql = 'INSERT INTO ' + tableName + ' SET ?';
        db.query(sql, obj, function (err, result) {
            if (!err) {
                obj.id = result.insertId;
            } else {
                console.log(err)
            }
            callback(err, result.insertId);
        });
    },

    getBy: function (tableName, fieldName, value, connection, callback) {
        var sql = 'SELECT * FROM ' + tableName + ' WHERE ' + fieldName + ' IN (?)';
        db.query(sql, [value], connection, callback);
    },

    getOneBy: function (tableName, fieldName, value, connection, callback) {
        var sql = 'SELECT * FROM ' + tableName + ' WHERE ' + fieldName + ' IN (?) LIMIT 0, 1;';
        db.query(sql, [value], connection, first(callback));
    },
    findWhere: function (tableName, obj, connection, callback) {
        var sql = 'SELECT * FROM ' + tableName + ' WHERE ?;';
        db.query(sql, [obj], connection, utils.first(callback));
    },

    removeBy: function (tableName, fieldName, value, connection, callback) {
        var sql = 'DELETE FROM ' + tableName + ' WHERE ' + fieldName + ' IN (?);'
        db.query(sql, [value], connection, utils.first(callback));
    },
    remove: function (tableName, objs, connection, callback) {
        if (!Array.isArray(objs)) { objs = [objs]; }
        var ids = objs.map(function (obj) {
            if (typeof obj == "object") {
                return obj.id;
            } else {
                return obj;
            }
        });
        db.removeBy(tableName, 'id', ids, connection, callback);
    },

    saveOne: function (tableName, keys, connection, callback) {
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
        db.query(sql, params, connection, callback);
    },

    prepareController: function (model) {
        var tableName = model.tableName;

        model.db = db;
        
        model.insert = function (obj, connection, callback) {
            db.insert(tableName, obj, connection, callback);
        }

        model.saveOne = function (keys, connection, callback) {
            db.saveOne(tableName, keys, connection, callback);
        };

        model.findWhere = function (obj, connection, callback) {
            db.saveOne(tableName, obj, connection, callback);
        };

        model.remove = function (obj, connection, callback) {
            db.remove(tableName, obj, connection, callback)
        };

        model.fields.forEach(function (name, index) {
            var addName = name[0].toUpperCase() + name.slice(1).toLowerCase();

            model['getBy' + addName] = function (value, connection, callback) {
                db.getBy(tableName, name, value, connection, callback);
            };

            model['getOneBy' + addName] = function (value, connection, callback) {
                db.getOneBy(tableName, name, value, connection, callback);
            };

            model['removeBy' + addName] = function (value, connection, callback) {
                db.removeBy(tableName, name, value, connection, callback);
            };
        });
        return model;
    }
};

return db;
}
