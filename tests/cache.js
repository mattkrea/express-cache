'use strict';

const request = require('supertest');
const express = require('express');
const cache = require('../index');
const assert = require('assert');
const redis = require('redis');

beforeEach((done) => {
	redis.createClient().flushall(() => {
		done();
	});
});

describe('cache()', () => {
	it('should require a number for ttl', () => {
		assert.throws(() => {
			cache({ ttl: '123' });
		}, TypeError);
	});

	it('should require a valid redis client', () => {
		assert.throws(() => {
			cache({ client: '123' });
		}, TypeError);
	});

	it('should support disabling a series of routes', (done) => {
		const app = express();
		let counter = 0;
		app.use(cache({
			disabled: [
				'/uncached'
			]
		}));
		app.get('/cached', (req, res) => {
			return res.status(200).json({ counter: counter++ });
		});
		app.get('/uncached', (req, res) => {
			return res.status(200).json({ counter: counter++ });
		});

		request(app).get('/cached').end((e, firstCachedResponse) => {
			request(app).get('/cached').end((er, secondCachedResponse) => {
				assert.equal(firstCachedResponse.text, secondCachedResponse.text);
				request(app).get('/uncached').end((err, firstUncachedResponse) => {
					request(app).get('/uncached').end((errr, secondUncachedResponse) => {
						assert.notEqual(firstUncachedResponse.text, secondUncachedResponse.text);
						done();
					});
				});
			});
		});
	});

	it('should support explicitly allowing only a selection of routes', (done) => {
		const app = express();
		let counter = 0;
		app.use(cache({
			explicit: [
				'/cached',
				'/api/v1'
			]
		}));
		app.get('/cached', (req, res) => {
			return res.status(200).json({ counter: counter++ });
		});
		app.get('/api/v1/herp/derp', (req, res) => {
			return res.status(200).json({ counter: counter++ });
		});
		app.get('/uncached', (req, res) => {
			return res.status(200).json({ counter: counter++ });
		});

		request(app).get('/cached').end((e, firstUncachedResponse) => {
			request(app).get('/cached').end((er, secondUncachedResponse) => {
				assert.equal(firstUncachedResponse.text, secondUncachedResponse.text);
				request(app).get('/api/v1/herp/derp').end((errr, third) => {
					request(app).get('/api/v1/herp/derp').end((errror, fourth) => {
						assert.equal(third.text, fourth.text);
						request(app).get('/uncached').end((err, firstCachedResponse) => {
							request(app).get('/uncached').end((errrr, secondCachedResponse) => {
								assert.notEqual(firstCachedResponse.text, secondCachedResponse.text);
								done();
							});
						});
					});
				});
			});
		});
	});

	it('should respect ttl', (done) => {
		const app = express();
		let counter = 0;
		app.use(cache({
			ttl: 1
		}));
		app.get('/cached', (req, res) => {
			return res.status(200).json({ counter: counter++ });
		});
		app.get('/uncached', (req, res) => {
			return res.status(200).json({ counter: counter++ });
		});

		request(app).get('/cached').end((e, firstUncachedResponse) => {
			request(app).get('/cached').end((er, secondUncachedResponse) => {
				assert.equal(firstUncachedResponse.text, secondUncachedResponse.text);
				setTimeout(() => {
					request(app).get('/cached').end((err, firstCachedResponse) => {
						assert.notEqual(firstCachedResponse.text, secondUncachedResponse.text);
						done();
					});
				}, 1500);
			});
		});
	});
});
