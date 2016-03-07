# tMysqlDao
unopinioned mysql controller for more convinience.

## usage
```javascript
//require the module
var tMysqlDao= require('tmysqlcontroller');
// create a database object.
var db = tMysqlDao({
	connectionLimit: 5,
	user: 'root',
	password: '',
	database: 'myjsblog'
});
// define a DAO Template
var userDao = {
	tableName:'user',
	fields:{ // fields in the table
		id:{primary:true},
		name:{},
		password:{},
		registered:{},
		mail:{},
		avatar:{mapTo:{tableName:'image',foreignKey:'id'}} // avatar is an ID mapping to a image-table
	},
	has: {
        profilePicures: { tableName: 'image', foreignKey: 'uploader', localField: 'id', multiple: true }
        // makes it possible to load all pictures uploaded by some user
    }
}
db.prepareDao(userDao);

//insert some objects
userDao.insert({name:'Dave',password:'111111',mail:'dave@example.com',register: Date.now()})
userDao.insert({name:'Richard',password:'111111',mail:'richard@example.com'register: Date.now()})
userDao.insert({name:'Tobias',password:'111111',mail:'tobias@example.com'register: Date.now()})
userDao.insert({name:'Michael',password:'111111',mail:'michael@example.com'register: Date.now()})

//find one by Mail
userDao.getOneByMail('tobias@example.com',function(){err,tobias}{
    console.log(err,tobias) // null, {id:'2',name:'Tobias',password:'111111',mail:'tobias@example.com'register: Date.now()}
});




```
## benefit

After prepareDao, the userDao will look as followed.
Actually it is extented by many usefull methods usually needed working on a database.
All methods support to be executed in a [transaction](#transaction).
getAll, findWhere, and getBy* methods support  [paging](#paging).
The functions to request and provide the response in a node-style-callback (err, res)

```javascript

userDao = {	
        // the properties defined in the template don't change
	tableName:'user',
	fields:{
        id:{primary:true},
        name:{},
        password:{},
        registered:{},
        mail:{},
		avatar:{mapTo:{tableName:'image',foreignKey:'id'}}
    },
	has: {
        screens: { tableName: 'screen', foreignKey: 'owner', localField: 'id', multiple: true }
    }
   	// extentions
    
    // the database object provided by tMysqlDao
    db: db, 

	// query the entire table without conditions
	getAll: function(){/*logic*/},

	// query rows with specitic value on the given named collomn
	// the value can also be an object with that value
	getById: function(){/*logic*/},
	getByName: function(){/*logic*/},
	getByPassword: function(){/*logic*/},
	getByRegistered: function(){/*logic*/},

	// getOne* is same as getBy, but you only get the first -> need no paging
	getOneById: function(){/*logic*/},
	getOneByName: function(){/*logic*/},
	getOneByRegistered: function(){/*logic*/},
	getOneByPassword: function(){/*logic*/},

	// fetch methods query the related data from an other table.
	// they will attach the result to the given objects create plane objects if only ids have been provided
	// as a third parameter it provides the original result list. (as flatt array)
	fetchScreen: function(obj){/*logic to fetch screen objects and attatch them to the given userObjects*/},
	fetchAvatar: function(obj){/* load image from ImageTable and attatch it to the user */}

	// delete objects based on the key
	remove: function(objs){/* remove logic*/};
	// insert a single object matching the row fieldnames, extending the key if possiable
	insert: function(obj){/* executing the insert and fetch the ID*/},
	// if you changed the objects in code you can save them back and update the database
	save: function(objs){/*delete one or more objects*/}
	// save for only one by one. because updates by id only can be done one by one. 
	// if you need something like "increase where" use the db.query.
	saveOne: function(obj){/*save the objects properties by the primaryKey*/}	
}

```

This is a good start that will help you to follow great programming principles.

1. KISS: this framework is very close on the mysql module. providing you more comfortablity without make you learn and study many internals.
2. Convention before configuration: when doing a request using the mysql library, you get dataobjects with the same property names as the fields in your table.
3. separation of concernes: it is about fetching and updating data, you can easily build a similar framework to store the data in mongo, couchdb, readis or what ever db/rest-service providing the same api. you will also make Controller objects for validation, authentication,...
4. single responsibility principle: one Dao should handle one tables objects.
5. Don't repeat yourself: you get provided all methods, you usually need interacting with a table. You don't need to make them over and over again.
6. Principle of least astonishment: you can name you tables and names as you like, this framework give some reasonable defaults, but let you choose names for primary keys, foreighn keys ect.
7. SOLID (object-oriented design): by default, then fetching data, you receife plain old js objects (POJO). providing a factory method, You can receife objects of specific clases with specific behaviors.
8. Information hiding: using only the provided apis, you don't need to get in touch with SQL, but you can.


## bestpractice
The module is designed for nodejs. so it is good if you make a file in your project as followed:
```javascript
var connectonConfig = require("./mysqlConfig.json");
module.exports = require("tmysqlcontroller")(connectionConfig);
```
And then make a folder with your controllers that look like that: 
```javascript
var db = require("./db");
var userDao = module.exports = db.prepareController({
	tableName:'user',
	fields:{ // fields in the table
		id:{primary:true},
		name:{},
		password:{},
		registered:{},
		mail:{},
		avatar:{mapTo:{tableName:'image',foreignKey:'id'}} // avatar is an ID mapping to a image-table
	},
	has: {
        profilePicures: { tableName: 'image', foreignKey: 'uploader', localField: 'id', multiple: true }
        // makes it possible to load all pictures uploaded by some user
    }
});

// your further methods to handle this table.
// if you relaize to repeat yourself, it might be interesting for this framework

```


## transaction
To discribe the usage of transactions I need to discribe to use transactions and to support transactions.
All methods provided by this framework support transactions. That means they follow a special pattern.

### use transactions
The usage of transactions is very close to the transactions of the mysql module, but needs one step less.

```javascript
db.beginTransaction(function(err, connection){
	//use your use the connections in all methods that support transactions.
    db.save({id:"1",obj:"data"},function(err){
    	if(err) {
        	connection.rollback();
        } else {
        	connection.commit();
        }
    }, connection);
});
````
The db module internaly uses the connectionpool of mysql. beginTransaction will get a connection from that pool and start the connection. When you commit or rollback, the framework will also release the connection back to the pool.

### support transactions
You have seen, to use a method that supports transactions you pass the transaction-connection into the method, after the callback. This paradime makes let the developer of a method prepare the response for direct on the callback without if there is a connection or not. To write a method that supports the transactions, you simple pass the last argument into the query method as last argument.
```javascript
/**
 * method to increase the likecount of a user
 * @param {String} id the user to target
 * @param {Number} amount about to change the count
 * @param {Object} conneciton to supports transactions
 */
userDao.increaseById = function(id, amount, callback, conneciton){
	this.db.query("UPDATE ?? SET likes = likes + ? WHERE ?? = ?",[this.tableName, amount, "id", id], callback, connection);
};
```
You see, simple pass the connection into an other transaction supporting method;

## paging
The base of the pageing is db.selectPaged(). witch is the query method with two additional optional parameter. page and pageSize before the callback. It will execute the query using db.query with a sqlString extended by a limit clouse. It will also execute the query with counting the results, to provide resultCount and pageCount as third argument to the callback.

```javascript
userDao.getAll(0,10,function(err, res, counts){
	console.log(err)// null;
    console.log(res)// [the 10 first userobjects]
    console.log(counts.resultCount) // 199
    console.log(counts.pageCount) // 20
});
```

## function reference
For now check out the source under [Github/tobiasnickel/tmysqlcontroller.js](https://github.com/TobiasNickel/tmysqlcontroller/blob/master/tMysqlController.js). The code is not to long and documented



















