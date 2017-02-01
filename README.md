# Express.js caching middleware

## Install

`yarn install express-cache`

## Usage

```js

'use strict';

const express = require('express');
const redis = require('redis');
const cache = require('cache');

const app = express();

app.use(cache({
	ttl: 60 // How long (in seconds) to hold onto cached responses
	enabled: true, // Enable caching (setting exists to easily disable in specific environments)
	includeBody: true, // Include the body in hashing the request
	disabled: [ // Specify some routes that shouldn't be cached
		'/ping',
		'/auth'
	],
	headers: [ // Any unique headers you want to include when hashing the request
		'X-Access-Token'
	],
	client: redis.createClient() // A node redis client
}));

app.use('/', (req, res) => {
	res.ttl(5) // Optionally override the global ttl in middleware
	return next();
});

```

## What Express response methods are cached?

* `.set()`
* `.send()`
* `.json()`
* `.status()`
