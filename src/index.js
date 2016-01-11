import Emitter from 'wildemitter';
import jan from 'jan';
import Store from './store';

const enc = encodeURIComponent;

const EMPTY_FUNC = ()=>{};

const URL = '/api';		// 'https://v1.peachapi.com'

export default ({ url=URL, store, init=true }={}) => {
	let api = jan.ns(url),
		peach = new Emitter();

	if (!store) store = new Store('peach-client');

	peach.api = api;
	peach.url = url;
	peach.store = store;

	peach.init = callback => {
		if (typeof callback!=='function') callback = EMPTY_FUNC;
		let state = store.getState(),
			{ email, password } = state;
		if (email && password) {
			peach.login({ email, password }, err => {
				if (err) {
					// console.log('stored credentials failed: '+err);
					store.setState({ token:null });
					peach.emit('logout', {});
					callback('Invalid credentials', false);
				}
				else {
					//peach.emit('login', state);
					callback(null, true);
				}
			});
		}
		else {
			callback(null, false);
		}
	};

	peach.isLoggedIn = () => !!store.getState().token;


	api.on('req', ({ xhr, req }) => {
		// xhr.withCredentials = false;

		let h = req.headers || (req.headers = {}),
			{ id, token, streams } = store.getState(),
			[, streamId] = req.url.match(/\/stream\/id\/([^\/]+)(\/|$)/i) || [];

		if (!streamId && req.url.match(/\/stream\/visibility$/g)) {
			streamId = streams && streams[0] && streams[0].id;
		}

		if (streams && streamId) {
			let idToken = streams.filter(s=>s.id===streamId).map(s=>s.token)[0];
			if (idToken) {
				h.Authorization = `Bearer ${idToken}`;
			}
		}

		if (token && !h.Authorization) {
			h.Authorization = `Bearer ${token}`;
		}

		h.Accept = 'application/json';
		if (req.body && typeof req.body!=='string') {
			h['Content-Type'] = 'application/json';
			req.originalBody = req.body;
			req.body = JSON.stringify(req.body);
		}
	});

	api.on('res', ({ res, req }) => {
		let { data } = res;

		if (res.status===401) {
			res.error = 'Unauthorized';
			return;
		}

		if (data) {
			let error = data.error || (data.success===0 && 'Unspecified error');
			if (error) {
				res.error = error.Message || error.message || error;

				// overwrite incorrect http status codes
				if (res.status===200) {
					res.status = error.Code || error.code || 520;
				}
			}

			if (data.data) res.data = data = data.data;

			// parse out successful auth repsonses
			let { token, streams } = data,
				state = store.getState();
			if (streams) {
				let { id } = streams[0];
				store.setState({ id, streams });
			}
			if (token && token!==state.token) {
				peach.emit('login', store.getState());
				let credentials = req.originalBody;
				// console.log(credentials, req, res);
				store.setState({ token, ...credentials });
			}
		}

		// @TODO: check token here
		// let token = e.data;
		// if (token) {
		// 	let prev = store.getState().token;
		// 	if (token!==prev) store.setState({ token });
		// }
	});


	// strip res from callback
	let cb = callback => (err, res, data) => {
		// console.log(err, res, data);
		callback(err, data);
		callback = null;
	};


	// create a post method
	let method = (method, url) => (...args) => {
		let callback = args.pop(),
			body = args.pop();
		api({ method, url, body }, cb(callback));
	};


	/** { email, password } */
	peach.login = method('post', '/login');

	/** { name, email, password } */
	peach.register = method('post', '/register');

	peach.connections = method('get', '/connections');
	peach.connections.explore = method('get', '/connections/explore');

	peach.user = {};

	/** Fetch the stream for a given user (by id) */
	peach.user.stream = (id, callback) => {
		let { streamCache } = store.getState();
		if (id==='me') id = store.getState().id;
		if (streamCache && streamCache.hasOwnProperty(id) && streamCache[id]) {
			return callback(null, streamCache[id]);
		}
		api.get(`/stream/id/${id}`, (err, res, data) => {
			if (data) {
				let { streamCache={} } = store.getState();
				streamCache[id] = data;
				store.setState({ streamCache });
			}
			callback(err, data);
		});
	};

	peach.user.me = callback => {
		let { id, profile } = store.getState();
		if (profile) return callback(null, profile);
		peach.user.stream(id, (err, profile) => {
			if (profile) store.setState({ profile });
			callback(err, profile);
		});
	};

	/** Publish a text post */
	peach.post = (post, callback) => {
		if (typeof post==='string') post = { text:post, type:'text' };
		api.post('/post', { message:[post] }, cb(callback));
	};

	/** Like a post */
	peach.like = (postId, callback) => api.post('/like', { postId }, cb(callback));

	/** Un-like a post */
	peach.unlike = (postId, callback) => api.delete(`/like/postID/${id}`, cb(callback));

	/** Set your stream visibility */
	peach.setVisibility = method('post', '/stream/visibility');

	/** Get your stream visibility */
	peach.getVisibility = method('get', '/stream/visibility');

	/** Issue a friend request */
	peach.addFriend = (username, callback) => api.post(`/stream/n/${enc(username)}/connection`, cb(callback));

	if (init) setTimeout(peach.init, 1);
	return peach;
};
