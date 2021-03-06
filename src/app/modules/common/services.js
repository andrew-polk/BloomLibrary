angular.module('BloomLibraryApp.services', ['restangular'])
	.factory('authService', ['Restangular', "$cookies", "errorHandlerService", '$analytics', 'sharedService', '$q',
        function (restangular, $cookies, errorHandlerService, $analytics, sharedService, $q) {
		var isLoggedIn = false;
		var isUserAdministrator = false;
		var userNameX = 'unknown';
        var bookshelves = [];
        var userObjectId = null;
        var saveUserNameTag = 'userName';
        var savePasswordTag = 'password';
        restangular.addResponseInterceptor(function(data, operation, what, url, response, deferred) {
            var extractedData;
            // Restangular expects getList operations to return an array. Parse.com in many cases does not.
            // This interceptor cleans them up.
            if (operation === "getList") {
                if (what == 'login') {
                    // the actual object we want is returned.
                    extractedData = [data];
                }
                else if (url === "https://s3.amazonaws.com/bloomlibrary.org?prefix=installers/") { // s3 bucket listing
                    // the actual object we want is returned.
                    var json= $.xml2json(data);
                    extractedData = [];
                    var items = json.ListBucketResult.Contents;
                    for(i=0; i<items.length;i++){
                        var file = {};
                        file.name = items[i].Key.replace("installers/","");
                        if(file.name.indexOf(".msi")>-1 || file.name.indexOf(".exe")>-1) {
                            file.url = "http://bloomlibrary.org.s3.amazonaws.com/" + items[i].Key;
                            file.date = items[i].LastModified;
                            extractedData.push(file);
                        }
                    }
                }
                else {
                    // the data is typically in the results field of the object returned
                    extractedData = data.results;
                }
            } else {
                extractedData = data;
            }
            return extractedData;
        });
        restangular.setErrorInterceptor(function(response, deferred, responseHandler) {
            // Returning false indicates we wish to prevent any more processing.
            if (response.data && response.data.error) {
                // There is a valid message we wish to display to the user.
                // Let the calling code handle it.
                return true;
            }
            errorHandlerService.handleRestangularError(response);
            return false;
        });

        // These headers are the magic keys for our account at Parse.com
		// While someone is logged on, another header gets added (see setSession).
		// See also the keys below in the Parse.initialize call.
        var headers;
        if (!sharedService.isProductionSite) {
            if (sharedService.useLocalParseServer){
                headers = {
                    'X-Parse-Application-Id': 'myAppId',
                    'X-Parse-REST-API-Key': 'myRestKey'
                };
            } else {
                // assume we're running the "develop" version of the site
                headers = {
                    'X-Parse-Application-Id': 'yrXftBF6mbAuVu3fO6LnhCJiHxZPIdE7gl1DUVGR',
                    'X-Parse-REST-API-Key': 'KZA7c0gAuwTD6kZHyO5iZm0t48RplaU7o3SHLKnj'
                };
            }
        } else {
            // we're live! Use the real production keys
            headers = {
                'X-Parse-Application-Id': 'R6qNTeumQXjJCMutAJYAwPtip1qBulkFyLefkCE5',
                'X-Parse-REST-API-Key': 'P6dtPT5Hg8PmBCOxhyN9SPmaJ8W4DcckyW0EZkIx'
            };
        }
		restangularConfig = function (restangularConfigurer) {
            if (!sharedService.isProductionSite) {
                if (sharedService.useLocalParseServer) {
                    restangularConfigurer.setBaseUrl(sharedService.localUrl);
                } else {
                    restangularConfigurer.setBaseUrl(sharedService.sandboxUrl);
                }
			} else {
				restangularConfigurer.setBaseUrl(sharedService.productionUrl);
			}
			restangularConfigurer.setDefaultHeaders(headers);
		};

		factory = {

			userName: function () { return userNameX; },
			setUserName: function (newName) { userNameX = newName; },
            bookShelves: function() {return bookshelves;},

			isLoggedIn: function () { return isLoggedIn; },
			isUserAdministrator: function () { return isUserAdministrator; },
            userObjectId: function() {return userObjectId;},

			config: function () { return restangularConfig; },

			setSession: function (sessionToken) {
				var sessionTokenKey = 'X-Parse-Session-Token';
				if (sessionToken) {
					headers[sessionTokenKey] = sessionToken;
					isLoggedIn = true;
				}
				else {
					delete headers[sessionTokenKey];
					isLoggedIn = false;
				}
			},

			login: function (username, password, successCallback, errorCallback) {
				// We don't want login to depend on case, so that the user has to remember the exact case with which they signed up.
                // So we make sure (here and elsewhere) that the user names we pass to parse.com are all lower case.
                // So the user can see the name the way they typed it, we don't lower-case the email address; this also means
                // that in case, by any chance, they are using an email tool that is case dependent, emails will use the exact case they typed.
				return restangular.withConfig(restangularConfig).all('login').getList({ 'username': username.toLowerCase(), 'password': password })
					.then(function (results) {
                        if (results.length < 1) {return;}
                        var result = results[0];
                        userObjectId = result.objectId;
						isLoggedIn = true;
						isUserAdministrator = result.administrator;
						userNameX = username;
                        // There's no expiration on this...browser will remember your details until you log out, even
                        // if you close the browser altogether. This is not meant to be high-security.
                        $cookies[saveUserNameTag] = username;
                        $cookies[savePasswordTag] = password;

                        $analytics.eventTrack('Log In', {username: username});

                        restangular.withConfig(restangularConfig).all('classes/bookshelf').getList({ 'where':{'owner': {"__type":"Pointer","className":"_User","objectId":result.objectId} }})
                            .then(function (response) {
                                bookshelves = response;
                                if (!response) {bookshelves = [];}
                            });
                        factory.setSession(result.sessionToken); // im not sure this actually works
						successCallback(result);
					},
				function (result) {
					isLoggedIn = false;
					isUserAdministrator = false;
					userNameX = 'unknown';
					errorCallback(result);
				});
			},

			logout: function () {
                $analytics.eventTrack('Log Out', {userName: $cookies[saveUserNameTag]});

                $cookies[saveUserNameTag] = '';
                $cookies[savePasswordTag] = '';

                isLoggedIn = false;
				factory.setSession('');
			},

			// curl -X POST \
			//	-H "X-Parse-Application-Id: mqNCpJ1nB4a597asLF61OwYclJCOwfzgMNTMF6LL" \
			//  -H "X-Parse-REST-API-Key: QN9bdJ8JODDYxUSXqWZTaz2y8WcX3d5kMi6ha3TU" \
			//  -H "Content-Type: application/json" \
			//  -d '{"email":"coolguy@iloveapps.com"}' \
			//  http://bloom-parse-server-development.azurewebsites.net/parse/requestPasswordReset
			sendResetPassword: function(email)
			{
				// It took some experimentation to get restangular to make the post we wanted, with
				// fewer elements in the path than expected. There may be a simpler way, but this works.
				// Enhance: is there any need/possibility of detecting errors here?
				// For example, what if it's not a valid email address we know? Or if the network is down?
				return restangular.withConfig(restangularConfig).one("requestPasswordReset").post('', {"email":email});
			},

            tryLogin: function () {
                var tryUserName = $cookies[saveUserNameTag];
                var tryPassword = $cookies[savePasswordTag];
                if (tryUserName) {
                    return factory.login(tryUserName, tryPassword, function() {}, function() {});
                }
                else
                {
                    var deferred = $q.defer();
                    deferred.resolve();
                    return deferred.promise;
                }
            }
		};


		return factory;
	} ])

    .service('sharedService', function() {

        // Set this to true when you want to run against your own local parse server
        this.useLocalParseServer = false;

        this.isProductionSite = window.location.host.indexOf("bloomlibrary.org") === 0;

        this.productionUrl = "https://bloom-parse-server-production.azurewebsites.net/parse";
        this.sandboxUrl = "https://bloom-parse-server-develop.azurewebsites.net/parse";

        this.localUrl = "http://localhost:1337/parse";
    })

    .service('bookService', ['Restangular', 'authService', '$q', '$rootScope', 'errorHandlerService', '$analytics', 'sharedService', '$cookies',
        function (restangular, authService, $q, $rootScope, errorHandlerService, $analytics, sharedService, $cookies) {
		// Initialize Parse.com javascript query module for our project.
		// Note: we would prefer to do things in this service using the REST API, but it does not currently support
		// substring matching and other things we need.
		// Please keep using the REST API wherever possible and the javascript API only where necessary.
		// Enhance: it is probably possible to implement server-side functions and access them using REST instead of
		// using the parse.com javascript API. We are limiting use of this API to this one file in order to manage
		// our dependency on parse.com.
        if (!sharedService.isProductionSite) {
            if (sharedService.useLocalParseServer) {
                Parse.initialize('myAppId', 'myRestKey');
                Parse.serverURL = sharedService.localUrl;
            } else {
                // we're running somewhere other than the official release of this site...use the silbloomlibrarysandbox api strings
                Parse.initialize('yrXftBF6mbAuVu3fO6LnhCJiHxZPIdE7gl1DUVGR', '16SZXB7EhUBOBoNol5f8gGypThAiqagG5zmIXfvn');
                //test site
                //Parse.initialize('llt7pS0BDnuPvz7Laci2NY04jWWrzmDhlLapQVxv', 'fFumVaz2kanqGHNXE6GXyVheGcDo9xdnYrUtfC2G');
                Parse.serverURL = sharedService.sandboxUrl;
            }
        } else {
            // we're live! Use the real silbloomlibrary api strings.
            Parse.initialize('R6qNTeumQXjJCMutAJYAwPtip1qBulkFyLefkCE5', 'bAgoDIISBcscMJTTAY4mBB2RHLfkowkqMBMhQ1CD');
            Parse.serverURL = sharedService.productionUrl;
        }
		this.getAllBooks = function () {
			return restangular.withConfig(authService.config()).all('classes/books').getList({ "limit": 50 }).then(function (resultWithWrapper) {
				return resultWithWrapper.results;
			});
		};
		this.getAllBooksCount = function () {
			return restangular.withConfig(authService.config()).all('classes/books').getList({ "limit": 0, "count": 1 }).then(function (resultWithWrapper) {
				return resultWithWrapper.count;
			});
		};

        this.getAllBookRelationships = function() {
             var baseRelatedBooks = restangular.withConfig(authService.config()).all('classes/relatedBooks');
            return baseRelatedBooks.getList({ 'include': "books" });
        };

        this.getBookshelves = function() {
            defer = $q.defer(); // used to implement angularjs-style promise

            var Bookshelf = Parse.Object.extend("bookshelf");
            var query = new Parse.Query(Bookshelf);
            query.ascending("englishName");
            query.limit(1000); // we want all the bookshelves there are, but this is the most parse will give us.

            // query.find returns a parse.com promise, but it is not quite the same api as
            // as an angularjs promise. Instead, translate its find and error functions using the
            // angularjs promise.
            query.find({
                success: function (results) {
                    var bookshelves = new Array(results.length);
                    for (i = 0; i < results.length; i++) {
                        bookshelves[i] = results[i].toJSON();
                    }

                    $rootScope.cachedAndLocalizedBookshelves = bookshelves.map(function(bookshelf) {
                        bookshelf.englishName = _localize(bookshelf.englishName);
                        return bookshelf;
                    });

                    defer.resolve();
                },
                error: function (error) {
                    errorHandlerService.handleParseError('getBookshelves', error);
                    defer.reject(error);
                }
            });

            return defer.promise;
        };

        this.getBookshelf = function(shelfKey) {
            // This version retrieves a version of the data and is shorter. But we use this object in ways that require
            // it to be an actual parse.com API bookshelf object.
//            return restangular.withConfig(authService.config()).all('classes/bookshelf').getList({ "key": shelfKey }).then(function (resultWithWrapper) {
//                return resultWithWrapper.results[0];
//            });
            var defer = $q.defer();
            var bookshelf = Parse.Object.extend("bookshelf");
            var query = new Parse.Query(bookshelf);
            query.equalTo("key", shelfKey);
            query.find({
                success: function (results) {
                    // I am not clear why the $apply is needed. I got the idea from http://jsfiddle.net/Lmvjh/3/.
                    // There is further discussion at http://stackoverflow.com/questions/17426413/deferred-resolve-in-angularjs.
                    // Maybe it is NOT needed here; copied logic from getFilteredBookRange
                    $rootScope.$apply(function () { defer.resolve(results[0]); });
                },
                error: function (error) {
                    errorHandlerService.handleParseError('getBookshelf', error);
                    defer.reject(error);
                }
            });
            return defer.promise;
        };

        // Returns a promise indicating whether the book is in the shelf
        // We will probably replace this with a different function that returns a list of the shelves a book is on,
        // once we support multiple books. Thus, I haven't particularly tried to make this elegant
        this.isBookInShelf = function(bookId, shelf) {
            var defer = $q.defer();
            var bookshelf = Parse.Object.extend("bookshelf");
            var query = new Parse.Query(bookshelf);
            query.get(shelf.objectId, {
                success: function(javaShelf) {
                    var presentQuery = new Parse.Query("books");
                    presentQuery.equalTo("objectId", bookId);
                    presentQuery.equalTo("tags", "bookshelf" + javaShelf.key);
                    presentQuery.find({
                        success:function(list) {
                            // Without the $rootScope.$apply, the promise action doesn't happen
                            // until something changes that forces an angular execution cycle.
                            $rootScope.$apply(function () { defer.resolve(list.length > 0);});
                        }
                    });
                },
                error: function(object, error) {
                    errorHandlerService.handleParseError('isBookInShelf', error);
                    defer.reject(error);
                }
            });
            return defer.promise;
        };

        // Reverse whether the book is a member of the shelf.
        this.ToggleBookInShelf = function(book, shelf) {
            // This should work (preliminary version...to ADD only) but runs into a bug in Parse,
            // No 'Access-Control-Allow-Origin' header is present on the requested resource.
            // So we use the javascript api
//            restangular.withConfig(authService.config()).one('classes/bookshelf/'+shelf.objectId).post('',
//                {books:{"__op":"AddRelation","objects":[{"__type":"Pointer","className":"books","objectId":book.objectId}]}});
            // the shelf and book objects may be restangular ones, not javascript ones. We need proper javascript API objects.
            // We can simplify this if we use javascript API objects more widely...but I think we may need the JSON-ified
            // objects for the angularJS interaction.
            var bookshelf = Parse.Object.extend("bookshelf");
            var query = new Parse.Query(bookshelf);
            query.get(shelf.objectId, {
                success: function(javaShelf) {
                    var books = Parse.Object.extend("books");
                    var bookQuery = new Parse.Query(books);
                    bookQuery.get(book.objectId, {
                        success: function(javaBook) {
                            var tag = "bookshelf:" + javaShelf.key;
                            var tags = javaBook.get("tags");
                            var tagIndex = tags.indexOf(tag);
                            if(tagIndex > -1){
                                tags.splice(tagIndex, 1);
                            }else{
                                tags.push(tag);
                            }
                            javaShelf.set("tags", tags);
                            javaShelf.save();
                        },
                        error: function(object, error) {
                            errorHandlerService.handleParseError('ToggleBookInShelf-book', error);
                        }
                    });
                },
                error: function(object, error) {
                    errorHandlerService.handleParseError('ToggleBookInShelf-shelf', error);
                }
            });
        };

        // Common to getFilteredBooks{Count,Range}
        // Generates a book query based on the parameters provided
        this.makeQuery = function(searchString, shelfKey, lang, tag, allLicenses) {
            var query;
            if (shelfKey) {
                if (shelfKey == "$recent") {
                    // Special query for recently modified books ("New Arrivals", currently defined as
                    // all books, but sorted to show most recently modified first).
                    query = new Parse.Query('books');
                    query.descending('createdAt');
                } else if (shelfKey == "$myUploads") {
                    query = new Parse.Query('books');
                    query.equalTo('uploader', {
                        __type: 'Pointer',
                        className: '_User',
                        objectId: authService.userObjectId()
                    });
                }
                else {
                    query = new Parse.Query('books');
                    if (!tag) {
                        if (shelfKey[shelfKey.length - 1] == "/") {
                            // trailing slash indicates a parent shelf, and we want to include the children
                            // whose keys start with this. However, there may also be books tagged with the
                            // parent key itself, so we must not include the slash in the starts-with.
                            query.startsWith("tags", "bookshelf:"+ shelfKey.substring(0, shelfKey.length - 1));
                        } else {
                            query.equalTo("tags", "bookshelf:"+ shelfKey);
                        }
                    }
                }
            } else {
                query = new Parse.Query('books');
            }
            if (searchString) {
                var searchWords = searchString.match(/[\w]+/g);
                for(var i = 0; i < searchWords.length; i++) {
                    query.contains('search', searchWords[i].toLowerCase());
                }
            }
            if (lang) {
                var langQuery = new Parse.Query('language');
                langQuery.equalTo('isoCode', lang);
                query.matchesQuery('langPointers', langQuery);
            }
            if (tag) {
                if (shelfKey) {
                    query.containsAll("tags", ["bookshelf:" + shelfKey, tag]);
                } else {
                    // if our tag X does not contain ':' or if it starts with 'topic:',
                    // look up all books with tag topic:X or X
                    if (tag.indexOf(':') < 0) {
                        query.containedIn("tags", [tag, 'topic:' + tag]);
                    } else if (tag.indexOf('topic:') === 0) {
                        query.containedIn("tags", [tag, tag.substring(6)]);
                    } else {
                        // starts with a prefix other than 'topic:'; do a simple equalTo
                        query.equalTo("tags", tag);
                    }
                }
            }
            if (!allLicenses) {
                query.startsWith('license', 'cc'); // not cc-, that excludes cc0
            }
            return query;
        };

		// Gets the count of books we currently want to display.
		// Returns a promise which will deliver the count.
		// The caller will typically do getFilteredBooksCount(...).then(function(count) {...}
		// and inside the scope of the function count will be the book count.
		// See comments in getFilteredBookRange for how the parse.com query is mapped to an angularjs promise.
		this.getFilteredBooksCount = function (searchString, shelfKey, lang, tag, includeOutOfCirculation, allLicenses) {
            $analytics.eventTrack('Book Search', {searchString: searchString || '', shelf: shelfKey || '', lang: lang || '', tag: tag || '', allLicenses: allLicenses || ''});
			var defer = $q.defer();

            var query;
            if (!searchString && !shelfKey && !lang && !tag && allLicenses) {
                query = new Parse.Query('books'); // good enough for count, we just want them all in some order.
            } else {
                query = this.makeQuery(searchString, shelfKey, lang, tag, allLicenses);
            }

            if(!includeOutOfCirculation) {
                query.containedIn('inCirculation', [true, undefined]);
            }

            query.count({
				success: function (count) {
                    // Generally we return the count as returned by the query. As a special case the New Arrivals list
                    // is limited to a maximum of 50 results.
					$rootScope.$apply(function () { defer.resolve(shelfKey == "$recent" && count > 50 ? 50 : count); });
				},
				error: function (error) {
                    errorHandlerService.handleParseError('getFilteredBooksCount', error);
					defer.reject(error);
				}
            });

			return defer.promise;
		};

		this.getBookRange = function (first, count) {
			return restangular.withConfig(authService.config()).all('classes/books').getList({ "skip": first, "limit": count }).then(function (resultWithWrapper) {
				return resultWithWrapper.results;
			});
		};

		// We want a subset of the books of current interest.
		// From that set we want up to count items starting at first (0-based).
		// We will return the result as an angularjs promise. Typically the caller will
		// do something like getFilteredBookRange(...).then(function(books) {...do something with books}
		// By that time books will be an array of json-encoded book objects from parse.com.
		this.getFilteredBookRange = function (first, count, searchString, shelfKey, lang, tag, allLicenses, sortBy, ascending, includeOutOfCirculation) {
			var defer = $q.defer(); // used to implement angularjs-style promise
            if (!searchString && !shelfKey && !lang && !tag) {
                // default initial state. Show featured books and then all the rest.
                // This is implemented by cloud code, so just call the cloud function.
                // Enhance: if we want to control sorting for this, we will need to pass the appropriate params
                // to the cloud function.
                Parse.Cloud.run('defaultBooks', { first: first, count: count, includeOutOfCirculation: includeOutOfCirculation, allLicenses: allLicenses }, {
                    success: function(results) {
                        // enhance JohnT: a chunk of duplicate code here should be pulled out into a function.
                        var objects = new Array(results.length);
                        for (i = 0; i < results.length; i++) {
                            //Technically, we probably shouldn't use the private function here, but toJSON does not jsonize the objects' objects
                            objects[i] = results[i]._toFullJSON();
                        }
                        // I am not clear why the $apply is needed. I got the idea from http://jsfiddle.net/Lmvjh/3/.
                        // There is further discussion at http://stackoverflow.com/questions/17426413/deferred-resolve-in-angularjs.
                        // Without it, the display does not update properly; typically each click updates to what it
                        // should have been after the previous click.
                        $rootScope.$apply(function () { defer.resolve(objects); });
                    },
                    error: function(error) {
                        errorHandlerService.handleParseError('getFilteredBookRange-defaultBooks', error);
                        defer.reject(error);
                    }
                });
                return defer.promise;
            }
            // This is a parse.com query, using the parse-1.2.13.min.js script included by index.html
			var query = this.makeQuery(searchString, shelfKey, lang, tag, allLicenses);

            //Hide out-of-circulation books
            if(!includeOutOfCirculation) {
                query.containedIn('inCirculation', [true, undefined]);
            }

            query.skip(first);
            query.limit(count);
            query.include("langPointers");
            query.include("uploader");
			// Sorting probably works only for top-level complete fields.
			// It does not work for e.g. (obsolete) volumeInfo.title.
            // The $recent shelf is implemented as a special sort, so we need to disable any other for that.
			if (sortBy && (shelfKey != '$recent')) {
				if (ascending) {
					query.ascending(sortBy);
				}
				else {
					query.descending(sortBy);
				}
			}
			// query.find returns a parse.com promise, but it is not quite the same api as
			// as an angularjs promise. Instead, translate its find and error functions using the
			// angularjs promise.
			query.find({
				success: function (results) {
					var objects = new Array(results.length);
					for (i = 0; i < results.length; i++) {
                        //Technically, we probably shouldn't use the private function here, but toJSON does not jsonize the objects' objects
						objects[i] = results[i]._toFullJSON();
					}
					// I am not clear why the $apply is needed. I got the idea from http://jsfiddle.net/Lmvjh/3/.
					// There is further discussion at http://stackoverflow.com/questions/17426413/deferred-resolve-in-angularjs.
					// Without it, the display does not update properly; typically each click updates to what it
					// should have been after the previous click.
					$rootScope.$apply(function () { defer.resolve(objects); });
				},
				error: function (error) {
                    errorHandlerService.handleParseError('getFilteredBookRange', error);
					defer.reject(error);
				}
			});

			return defer.promise;
		};

		this.getBookById = function (id) {
			return restangular.withConfig(authService.config()).one('classes/books', id).get({include:"uploader,langPointers"});
		};

		this.getRelatedBooks = function(id) {
			var baseRelatedBooks = restangular.withConfig(authService.config()).all('classes/relatedBooks');

			return baseRelatedBooks.getList({
				'where': {
					'books': {
						"__type": "Pointer",
						"className": "books",
						"objectId": id
					}
				}, 'include': "books"
			});
		};

		this.deleteBook = function (id) {
			return restangular.withConfig(authService.config()).one('classes/books', id).remove();
		};

            this.modifyBookField = function(book, field, value, updateSource) {
                var rBook = restangular.withConfig(authService.config()).one('classes/books', book.objectId);
                if (authService.isUserAdministrator()) {
                    updateSource += ' (admin)';
                }

                var putParams = {};
                putParams[field] = value;
                putParams['updateSource'] = updateSource;

                // Have to do customPUT so it doesn't try to send "id" as a field
                rBook.customPUT(putParams);
            };

        // This function is invoked with an array of the ids of the books that should be put
        // into a group of related books. All will be removed from any other related-books groups.
        this.relateBooksById = function(idsOfBooksToRelate) {
            //Since it might be possible for the user to click a second book
            //faster than the server can process the request, I'm using an IIFE
            // which captures the current array in its argument.
            (function(idsOfBooksToRelate) {
                // Will become the list of ids of books to group as related, including ones already related to
                // the original idsOfBooksToRelate.
                var relatedBooks = [];

                var baseRelatedBooks = restangular.withConfig(authService.config()).all('classes/relatedBooks');

                var i = 0;

                // We want to loop over all IDs. But dealing with each one requires a query to parse.com, and we need
                // the results of all of them before we go on, which requires that the next iteration be in
                // a 'then' function of the post call. This is achieved with a recursive function,
                // which is called once to handle the first ID, and calls itself recursively from
                // inside 'then' to handle the others.
                // Fortunately, we don't expect massively large groups of related books.
                function handleOneId() {
                    //Base case, out of arguments: we now have the relatedBooks list we wanted,
                    // so we can process it by actually creating the new relationship.
                    if(i >= idsOfBooksToRelate.length) {
                        //Only create new relationship if two or more books are involved
                        if(relatedBooks.length > 1) {
                            //Create new entry with relationship
                            baseRelatedBooks.post({"books": relatedBooks});
                        }
                    }
                    else {
                        //Add this book pointer to the list we want to make into a related group.
                        relatedBooks.push({
                            "__type": "Pointer",
                            "className": "books",
                            "objectId": idsOfBooksToRelate[i]
                        });
                        // Also remove it from any related books group it is already in.
                        baseRelatedBooks.getList({
                            'where': {
                                'books': {
                                    "__type": "Pointer",
                                    "className": "books",
                                    "objectId": idsOfBooksToRelate[i]
                                }
                            }
                        }).then(function (results) { // results are ids of books related to idsOfBooksToRelate[i], including itself
                            if (results.length > 0) {
                                //For some reason, I was unable to use results[0].remove()
                                // I (JohnT) don't fully understand this, but somehow I think it removes idsOfBooksToRelate[i]
                                // from the related-books group it was already part of.
                                restangular.withConfig(authService.config()).one('classes/relatedBooks', results[0].objectId).remove().then(function () {
                                    i++;
                                    handleOneId();
                                });
                            }
                            else {
                                i++;
                                handleOneId();
                            }
                        });
                    }
                }

                //Begin the recursive-function loop by calling it once.
                handleOneId();
            } (idsOfBooksToRelate)); // here the IIFE is invoked with the original function's list of ids.
        };

        this.resetCurrentPage = function () {
            $cookies["currentpage"] = 1;
        };

        this.getBookshelfDisplayName = function(shelfKey) {
            // Not saying I'm proud of this, but it works.
            // Some scenarios (can't remember currently) need to return this immediately, so we can't make
            // the asyncronous call to getBookshelves().
            // But some scenarios haven't yet populated $rootScope.cachedAndLocalizedBookshelves. Those
            // cases seem to work okay with the asyncronous call. (though I would think maybe this causes a
            // race condition? Or, hopefully, in that case we are actually replacing it as soon as we obtain it.
            // Spent too much time on this for now...)
            if ($rootScope.cachedAndLocalizedBookshelves) {
                return getBookshelfDisplayNameInternal(shelfKey, $rootScope.cachedAndLocalizedBookshelves);
            } else {
                // The call to getBookshelves() populates $rootScope.cachedAndLocalizedBookshelves
                this.getBookshelves().then(function() {
                    return getBookshelfDisplayNameInternal(shelfKey, $rootScope.cachedAndLocalizedBookshelves);
                });
            }
        };
        getBookshelfDisplayNameInternal = function(shelfKey, bookshelves) {
            for (i = 0; i < bookshelves.length; i++) {
                var shelf = bookshelves[i];
                if (shelfKey == shelf.key) {
                    return shelf.englishName;
                }
            }
            return shelfKey;
        };
	} ])
    .service('downloadHistoryService', ['Restangular', '$http', 'authService', function(restangular, $http, authService) {
        this.logDownload = function(bookId) {
            $http.get('http://icanhazip.com').success(function(ip) {
                console.log(ip);

                var username = authService.userName();

                var newEntry = {bookId: bookId, userIp: ip, userName: username};

                var downloadHistory = restangular.withConfig(authService.config()).all('classes/downloadHistory');

                downloadHistory.post(newEntry);
            });
        };
    }])
    .service('languageService', ['$rootScope', '$q', '$filter', 'errorHandlerService', function($rootScope, $q, $filter, errorHandlerService) {
        var languageList; // Used to cache the list

        // We want all the languages we know.
        this.getLanguages = function () {
            var defer = $q.defer(); // used to implement angularjs-style promise

            // This is a parse.com query, using the parse-1.2.13.min.js script included by index.html
            var query = new Parse.Query('language');
            // Configure the query to give the results we want.
            query.descending("usageCount");
            query.limit(1000); // we want all the languages there are, but this is the most parse will give us.

            // query.find returns a parse.com promise, but it is not quite the same api as
            // as an angularjs promise. Instead, translate its find and error functions using the
            // angularjs promise.
            query.find({
                success: function (results) {
                    var objects = new Array(results.length);
                    for (i = 0; i < results.length; i++) {
                        objects[i] = results[i].toJSON();
                    }
                    languageList = objects;
                    // See the discussion in getFilteredBookRange of why the $apply is used. I haven't tried
                    // NOT using it in this context.
                    $rootScope.$apply(function () { defer.resolve(objects); });
                },
                error: function (error) {
                    errorHandlerService.handleParseError('getLanguages', error);
                    defer.reject(error);
                }
            });

            return defer.promise;
        };
        this.getDisplayName = function(langId) {
            if (languageList) {
                if (langId) {
                    return $filter('filter')(languageList, {isoCode: langId})[0].name;
                } else {
                    return "";
                }
            } else {
                return "";
                // Just in case we haven't gotten the language list yet.
                // Theoretically, this shouldn't happen.  The first load will populate languageList, and
                // we don't need to call getDisplayName until a filter is clicked.
                // There may be a way to guarantee it is loaded first, but I haven't figured it out.
            }
        };
	} ])
    .service('parseAngularService', ['$rootScope', '$q', '$filter', 'errorHandlerService', function($rootScope, $q, $filter, errorHandlerService) {
        this.parsePromiseToAngular = function(parsePromise, functionRef) {
            // query.find and other queries return a parse.com promise, but it is not quite the same api as
            // as an angularjs promise. Instead, translate its find and error functions using the
            // angularjs promise.

            var defer = $q.defer(); // used to implement angularjs-style promise

            parsePromise.then(function(results) {
                var objects = new Array(results.length);
                for (i = 0; i < results.length; i++) {
                    objects[i] = results[i].toJSON();
                }
                // languageList = objects;
                // See the discussion in getFilteredBookRange of why the $apply is used. I haven't tried
                // NOT using it in this context.
                $rootScope.$apply(function () { defer.resolve(objects); });
            },
            function (error) {
                errorHandlerService.handleParseError(functionRef || 'unspecified', error);
                defer.reject(error);
            });

            return defer.promise;
        };
    }])
    .service('tagService', ['parseAngularService', 'bookService', function(parseAngularService, bookService) {
        this.getTags = function (category) {
            var tagQuery = new Parse.Query('tag');
            tagQuery.descending("usageCount");
            tagQuery.limit(1000);

            //If a category is specified, only get tags of that category
            if(category) {
                tagQuery.startsWith('name', category + '.');
            }

            var parsePromise =  tagQuery.find();
            return parseAngularService.parsePromiseToAngular(parsePromise, 'getTags');
        };
        //Remove category (e.g. 'region:')
        this.getDisplayName = function(tag) {
            try {
                var prefixRegex = /[a-z]+:/;
                var prefix = tag.match(prefixRegex);
                if (prefix == 'bookshelf:') {
                    return bookService.getBookshelfDisplayName(tag.replace(prefixRegex, ""));
                }
                return tag.replace(prefixRegex, "");
            }
            catch(error) {
                return tag;
            }
        };

        this.isSystemTag = function(tag) {
            var regex = new RegExp('^system:');
            return regex.test(tag);
        };

        this.isTopicTag = function(tag) {
            return tag.indexOf("topic:") === 0 || tag.indexOf(":") < 0;
        };

        this.hideSystemTags = function(book) {
            if(book.tags) {
                for (var i = book.tags.length-1; i >= 0; i--) {
                    var tag = book.tags[i];
                    if (this.isSystemTag(tag)) {
                        book.tags.splice(i, 1);
                    }
                }
            }
        };
    }])
	.service('userService', ['Restangular', 'authService', function (restangular, authService) {
		var checkforerror = function (callback) {


		};

		this.register = function (user, callback) {
			if (!user.mandatoryfield) {
                var user1 = $.extend({}, user);
                user1.username = user1.username.toLowerCase();
				return restangular.withConfig(authService.config()).all('users').post(user1).then(callback, callback);
			}
		};

		this.readByUserName = function (username, callback) {
			return restangular.withConfig(authService.config()).all('users').getList({ "where": '{"username": "' + username.toLowerCase() + '"}' }).then(callback, callback);
		};
	} ])
	.service('bookCountService', function () { // service to provide shared access to this object between detail and browse for delete
		var bookCountObject = {bookCount: 0};
		return {
			getCount: function() {
				return bookCountObject;
			}
		};
	})
	.service('bookshelfService', function () {
        this.getBookshelfHeaderSrc = function(bookshelfKey) {
            if (!bookshelfKey) {
                return "";
            } else {
                var filePath = "/assets/bookshelves/" + bookshelfKey + "/index.htm";
                return filePath;
            }
        };
        this.getCleanBookshelfName = function(shelfDisplayName) {
            var cleanName = shelfDisplayName;
            var i = shelfDisplayName.indexOf("_");
            if (i > 0) {
                cleanName = shelfDisplayName.substring(0, i);
            }
            cleanName = cleanName.replace(/\//g, " - ");
            return cleanName;
        };
	})
	.service('emailService', ['$q', 'authService', 'errorHandlerService', function ($q, authService, errorHandlerService) {
        this.sendConcernEmail = function(content, bookId) {

            defer = $q.defer();
            Parse.Cloud.run('sendConcernEmail', { fromAddress: authService.userName(), content: content, bookId: bookId }, {
                success: function(results) {
                    defer.resolve();
                },
                error: function(error) {
                    errorHandlerService.handleParseError('sendConcernEmail', error);
                    defer.reject(error);
                }
            });
            return defer.promise;
        };
	}])
    .service('errorHandlerService', ['$modal', '$analytics', function ($modal, $analytics) {
        var mostRecentUserMessage = 0; // a timestamp

        this.handleParseError = function(call, error) {
            try {
                $analytics.eventTrack('Error - Parse.com', {call: call, error: error});
                this.showUserErrorMessage();
            } catch (ignored) {
                console.log('Exception in handleParseError: ' + ignored);
            }
        };
        this.handleRestangularError = function(response) {
            try {
                // In a couple instances, passwords are returned to us in the response.
                // Attempt to scrub them before sending to analytics.
                // Review: Acceptable risk that the password could be moved to a different location in the json?
                if (response.config && response.config.data && response.config.data.password) {
                    // Error during Sign Up
                    response.config.data.password = 'SCRUBBED';
                }
                if (response.config && response.config.params && response.config.params.password) {
                    // Error during Log In
                    response.config.params.password = 'SCRUBBED';
                }
                $analytics.eventTrack('Error - Restangular', {response: response});
                this.showUserErrorMessage();
            } catch (ignored) {
                console.log('Exception in handleRestangularError: ' + ignored);
            }
        };
        this.showUserErrorMessage = function () {
            var now = Date.now();
            // Don't display a message more than once every 30 seconds
            if (now - mostRecentUserMessage > 30000) {
                mostRecentUserMessage = now;
                $modal.open({
                    templateUrl: 'modules/common/errorMessage.tpl.html',
                    controller: 'errorMessage'
                });
            }
        };
    }]);
