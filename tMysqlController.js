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

module.exports = function (config) {
    var db = {
        pool: mysql.createPool(config),
        /**
         * query method, that can get a connection, to support transactions
         * you can follow a paradime where you have connection and callback as the last two params, and call query with both.
         * so your method can also run in a transaction. otherwise the query method is compatible to the mysql-connection/pool.query method
         * @param {string} sql the querystring
         * @param {array} [params] the parameter that get insert into the query
         * @param {function} callback the callback that will receife the response
         * @param {mysql-connection} connection to be used for this query.
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
        /**
         * get a connectio where the transaction is started.
         * @param {connection-callback} callback, function called with a new transaction
         */
        beginTransaction(callback) {
            db.database.getConnection(function (err, connection) {
                if (err) { callback(err); return }
                connection.beginTransaction(function (err) {
                    if (err) { callback(err); return; }
                    callback(null, extendTransactionConnection(connection));
                });
            });
        },

        defaultPagesize: 20,

        /**
         * like query, but provide pageing for select queries.
         * @param {string} tableName, the table to insert
         * @param {object} obj data to insert
         * @param {Number} [page] the page to get, if not provided: get all
         * @param {Number} [pagesize] the number of objects to receife in a single request. default is 20
         * @param {function} callback the callback that will receife the response
         * @param {mysql-connection} connection to be used for this query.
         */
        selectPaged: function (sql, values, page, pagesize, callback, connection) {
            var paging = '';
            if (typeof page === 'function') {
                callback = page;
                connection = pagesize;
                page = null;
                pagesize = null;
            } else if (typeof pagesize === 'function') {
                connection = callback;
                callback = pagesize;
                pagesize = db.defaultPagesize;
            }
            if (page === null) {
                db.query(sql, values, callback, connection);
            } else {
                paging = " LIMIT " + (page * pagesize) + ',' + pagesize;
                sql += paging;
                var pages = null;
                var result = null;
                db.query(sql, values, function (err, res) {
                    if (err) { result = err; done(); return; }
                    result = res;
                    done();
                }, connection);
                db.query('SELECT count(*) as resultCount ' + sql.slice(sql.toLowerCase().indexOf('from')), values, function (err, c) {
                    if (err) { pages = err; done(); return; }
                    pages = c[0];
                    pages.pageCount = Math.ceil(pages.resultCount / pagesize);
                    done();
                }, connection);
                function done() {
                    console.log('db.selectPaged,', sql, values, page, pagesize)
                    if (pages !== null && result !== null) {
                        if (pages instanceof Error) {
                            callback(pages)
                        } else if (result instanceof Error) {
                            callback(result);
                        } else {
                            callback(null, result, pages);
                        }
                    }
                }
            }
        },

        /**
         * query data with a specific property.
         * @param {string} tableName, the table to insert
         * @param {string} fieldName the name of the collom
         * @param {mixed} value one or an Array of simple values where the result should have (String, Number, Boolean, null)
         * @param {Number} [pagesize] the number of objects to receife in a single request. default is 20
         * @param {function} callback the callback that will receife the response
         * @param {mysql-connection} connection to be used for this query.
         */
        getBy: function (tableName, fieldName, value, page, pagesize, callback, connection) {
            var sql = 'SELECT * FROM ' + tableName + ' WHERE ' + fieldName + ' IN (?)';
            db.selectPaged(sql, [value], page, pagesize, callback, connection);
        },

        /**
         * query data with a specific property.
         * @param {string} tableName, the table to insert
         * @param {string} fieldName the name of the collom
         * @param {mixed} value one or an Array of simple values where the result should have (String, Number, Boolean, null)
         * @param {Number} [pagesize] the number of objects to receife in a single request. default is 20
         * @param {function} callback the callback that will receife the first element of the response
         * @param {mysql-connection} connection to be used for this query.
         */
        getOneBy: function (tableName, fieldName, value, callback, connection) {
            var sql = 'SELECT * FROM ' + tableName + ' WHERE ' + fieldName + ' IN (?) LIMIT 0, 1;';
            db.query(sql, [value], first(callback), connection);
        },

        /**
         * query rows that have multiple specific values
         * @param {string} tableName, the table to insert
         * @param {object} object with key-values that should metch the resultRows
         * @param {Number} [pagesize] the number of objects to receife in a single request. default is 20
         * @param {function} callback the callback that will receifethe response
         * @param {mysql-connection} connection to be used for this query.
         */
        findWhere: function (tableName, obj, page, pagesize, callback, connection) {
            var sql = 'SELECT * FROM ' + tableName + ' WHERE ';
            var where = '1 '
            var values = [];
            for (var i in obj) {
                where += ' AND ?? = ?';
                values.push(i);
                values.push(obj[i]);
            }
            db.selectPaged(sql + where, values, page, pagesize, callback, connection);
        },

        /**
         * query rows that have multiple specific values
         * @param {string} tableName, the table to insert
         * @param {object} object with key-values that should metch the resultRows
         * @param {Number} [pagesize] the number of objects to receife in a single request. default is 20
         * @param {function} callback the callback that will receife the the first element of the response
         * @param {mysql-connection} connection to be used for this query.
         */
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

        /**
         * remove objects according to there primary key.
         * @param {string} tableName, the table to insert
         * @param {String | Array of String} idKey one or more names that make there primary key
         * @param {Object | Array} [objs] objects to delete from database. for single key tables a string or number is fine as key.
         * @param {function} callback the callback that will receifethe response
         * @param {mysql-connection} connection to be used for this query.
         */
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

        /**
         * Insert some oject to the given table it will only use the properties,
         * that are direct on the object(no prototype chain) and ignore neasted objects
         * @param {string} tableName, the table to insert
         * @param {object} obj data to insert
         * @param {function} callback the callback that will receife the response
         * @param {mysql-connection} connection to be used for this query.
         */
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

        /**
         * updates the values of rows, based on the primary key
         * @param {string} tableName, the table to insert
         * @param {String | Array of String} primaries one or more names that make there primary key
         * @param {Object | Array} objs one or more objects to update. (key can not change.)
         * @param {function} callback the callback that will receife the response
         * @param {mysql-connection} connection to be used for this query.
         */
        save: function (tableName, primaries, objs, callback, connection) {
            if (!Array.isArray(objs)) { objs = [objs]; }
            var number = objs.length;
            var count = 0;
            var errors = [];
            objs.foreEach(function (obj) {
                db.saveOne(tableName, primaries, obj, function (err) {
                    count++;
                    if (err) { errors.push([obj, err]); }
                    if (count === number) {
                        callback(errors.length ? errors : null);
                    }
                }, connection)
            });
        },

        /**
         * updates the values of a row, based on there primary key
         * @param {string} tableName, the table to insert
         * @param {String | Array of String} primaries one or more names that make there primary key
         * @param {Object} objs only ONE object to update. (key can not change.)
         * @param {function} callback the callback that will receife the response
         * @param {mysql-connection} connection to be used for this query.
         */
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
            sql += ' WHERE ';
            primaries.forEach(function (primary, index) {
                if (index) sql += ' AND ';
                sql += '?? = ?';
                params.push(primary);
                params.push(keys[primary]);
            });
            db.query(sql + ';', params, callback, connection);
        },

        /**
         * to extend a controller-template with all possible usefull methods
         * @param {object} comtroller having properties that discribe the table accessed by the controller.
         */
        prepareController: function (controller) {
            var tableName = controller.tableName;
            var IDKeys = [];

            controller.db = db;

            controller.insert = function (obj, callback, connection) {
                db.insert(tableName, obj, callback, connection);
            }
            controller.save = function (objs, callback, connection) {
                db.save(tableName, IDKeys, objs, callback, connection);
            };
            controller.saveOne = function (obj, callback, connection) {
                db.saveOne(tableName, IDKeys, obj, callback, connection);
            };

            controller.getAll = function (page, pageSize, callback, connection) {
                db.selectPaged("SELECT * FROM ??", [tableName], page, pageSize, callback, connection);
            };

            controller.findWhere = function (obj, page, pageSize, callback, connection) {
                db.findWhere(tableName, obj, page, pageSize, connection, callback);
            };
            controller.findOneWhere = function (obj, callback, connection) {
                db.findOneWhere(tableName, obj, callback, connection);
            };

            controller.remove = function (obj, callback, connection) {
                db.remove(tableName, IDKeys, obj, callback, connection);
            };
            for (var i in controller.fields) {
                (function (name, definition) {
                    var addName = name[0].toUpperCase() + name.slice(1).toLowerCase();

                    controller['getBy' + addName] = function (value, page, pageSize, callback, connection) {
                        db.getBy(tableName, name, value, page, pageSize, callback, connection);
                    };

                    controller['getOneBy' + addName] = function (value, callback, connection) {
                        db.getOneBy(tableName, name, value, callback, connection);
                    };

                    controller['removeBy' + addName] = function (value, callback, connection) {
                        db.remove(tableName, name, value, callback, connection);
                    };
                    prepareFetchMethod(db, controller, tableName, name, definition);
                    if (definition.primary) { IDKeys.push(name); }
                })(i, controller.fields[i]);
            }
            if (!IDKeys.length) IDKeys.push('id');
            if (controller.has) {
                for (var name in controller.has) {
                    prepareFetchMethod(db, controller, tableName, name, { mapTo: controller.has[name] });
                }
            }
            return controller;
        }
    };
    return db;
}

/**
 * extent the crontroller with methods to fetch related data.
 */
function prepareFetchMethod(db, controller, tableName, name, definition) {
    var addName = name[0].toUpperCase() + name.slice(1).toLowerCase();
    var fetchName = definition.fatchName || ('_' + name);
    controller['fetch' + addName] = function (objs, callback, connection) {
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
                            if (!obj[fetchName]) obj[fetchName] = [];
                            obj[fetchName].push(item);
                        } else {
                            obj[fetchName] = item;
                        }
                    });
                });
                callback(null, objs, list);
            }, connection);
    }
}
