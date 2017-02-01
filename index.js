'use strict';

const crypto = require('crypto');
const redis = require('redis');

/**
 * @typedef  {Object} CachingOptions
 *
 * @property {Number}   [ttl]         - Time in seconds to keep a given cache entry around (default: 60)
 * @property {Boolean}  [enabled]     - Set to false to disable caching (perhaps in a staging environment)
 * @property {Boolean}  [includeBody] - Set to false to disable including the request body in the hash
 * @property {String[]} [disabled]    - Routes (or base paths) that should not be cached
 * @property {String[]} [headers]     - Headers to take into consideration for the cache (e.g. Authorization)
 * @property {String[]} [explicit]    - The *only* routes that should be cached--If set this will ignore `disabled`
 * @property {Object}   [client]      - Redis client to use (default: `redis.createClient()`)
 */

/**
 * Create an instance of the middleware configured to your liking
 *
 * @param   {CachingOptions} [opts] - Middleware configuration
 * @returns {Function}                 Express middleware
 */
module.exports = function(opts) {

	opts = Object.assign({
		ttl: 60,
		enabled: true,
		includeBody: true,
		disabled: [],
		headers: [],
		explicit: undefined,
		client: undefined
	}, opts);

	if (typeof opts.ttl !== 'number') {
		throw new TypeError(`'ttl' must be an integer`);
	}

	if (opts.client &&
		(typeof opts.client.hmset !== 'function' || typeof opts.client.hgetall !== 'function')) {
		throw new TypeError(`'client' must be a valid 'redis' client`);
	}

	if (opts.client === undefined) {
		opts.client = redis.createClient();
	}

	let client = opts.client;

	let isUsingExplicitAssignment = opts.explicit && opts.explicit.every((x) => typeof x === 'string');

	/**
	 * Generate a hash to identify a given request
	 *
	 * @param   {express.request} req - Express request object to hash
	 * @returns {String} Request hash (sha1)
	 */
	function hash(req) {
		let h = crypto.createHash('sha1');

		opts.headers.forEach((header) => {
			h = h.update(`${req.headers[header]}`);
		});

		if (opts.includeBody && typeof req.body === 'object') {
			h = h.update(`${JSON.stringify(req.body)}`);
		}

		return h.update(req.originalUrl).digest('hex');
	}

	return function(req, res, next) {

		if (opts.enabled === false) {
			return next();
		}

		if (isUsingExplicitAssignment && !opts.explicit.some((x) => req.path.indexOf(x) === 0)) {
			return next();
		} else if (opts.disabled.some((x) => req.path.indexOf(x) === 0)) {
			return next();
		}

		req.hash = hash(req);

		client.hgetall(req.hash, (readErr, cachedResponse) => {
			if (cachedResponse) {

				// If we found a cached record lets try and get the TTL
				// to tell the caller how much longer it will be around
				client.ttl(req.hash, (ttlErr, ttl) => {
					if (ttl) {
						res.set('Cache-Control', `max-age=${ttl}`);
					}

					if (cachedResponse && cachedResponse.status && cachedResponse.body) {
						if (cachedResponse.headers) {
							try {
								res.set(JSON.parse(cachedResponse.headers));
							} catch (parseError) {
								// Nothing to do here
							}
						}

						if (typeof cachedResponse.attachment === 'string') {
							res.attachment(cachedResponse.attachment);
						}

						res.status(parseInt(cachedResponse.status));
						return res.send(typeof cachedResponse.body === 'string' ? cachedResponse.body : JSON.stringify(cachedResponse.body));
					}
				});
			} else {

				// If nothing was found in the cache we need to override
				// several methods in Express to capture normal responses in the cache
				let { attachment, status, send, set, json } = res;

				// Keep a teensy bit of state
				res.cache = {
					statusCode: 0,
					body: '',
					headers: { },
					ttl: opts.ttl,
					attachment: null
				};

				res.ttl = function(time) {
					if (!isNaN(time)) {
						res.cache.ttl = time;
					}
				};

				// Capture any headers intended to be returned on the request
				res.set = function(key, value) {
					if (typeof key === 'object') {
						Object.keys(key).forEach((prop) => {
							res.cache.headers[prop] = key[prop];
						});
					}

					res.cache.headers[key] = value;

					return set.apply(res, arguments);
				};

				// Capture the status code
				res.status = function(code) {
					res.cache.statusCode = code;
					return status.apply(res, arguments);
				};

				// Capture any possible attachments that have been set
				res.attachment = function(filename) {

					// Special thing to note here is that if an attachment
					// is provided, instead of manually adjusting
					// Content-Disposition, etc we will just call on Express
					// when the time comes
					res.cache.attachment = filename;

					return attachment.apply(res, arguments);
				};

				// Capture (mostly) plain text responses
				res.send = function(data) {
					store(data);
					return send.apply(res, arguments);
				};

				// Capture any JSON responses
				res.json = function(data) {
					res.cache.headers['Content-Type'] = 'application/json';
					store(data);
					return json.apply(res, arguments);
				};

				return next();
			}
		});

		/** Shared logic for both `.send()` and `.json()` that will
		 *  actually perform the write to the cache
		 *
		 *  @param {String|Object} data - Data intended to be delivered to the caller
		 */
		function store(data) {

			let entry = {
				status: res.cache.statusCode || 200,
				body: typeof data === 'string' ? data : JSON.stringify(data),
				headers: JSON.stringify(res.cache.headers)
			};

			if (res.cache.attachment) {
				entry.attachment = res.cache.attachment;
			}

			client.hmset(req.hash, entry, () => {
				client.expire(req.hash, res.cache.ttl);
			});
		}
	};
};
