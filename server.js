const cookieParser = require('cookie-parser');
const express = require('express')
const mysql = require('mysql');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const cookie = require('cookie');
const axios = require('axios');
const AWS = require('aws-sdk');
const JSZip = require('jszip');
const dotenv = require('dotenv')
dotenv.config()
const Cryptr = require('cryptr');
const cryptr = new Cryptr(process.env.ENCRYPTION_KEY);

const app = express();

app.use(cors({
	origin: process.env.FRONTEND_URL,
	methods: ["GET", "POST", "OPTIONS"],
	credentials: true
}));

var userid = 0;

app.use(session({
	secret: process.env.SESSION_SECRET,
	resave: false,
	saveUninitialized: true,
	cookie: {
		secure: false,
		maxAge: 1000 * 60 * 60 * 24 * 7
	}
}))

app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.json());

app.post('/signout', (req, res) => {
	// Destroy the session on the server
	userid = 0;
	req.session.destroy((err) => {
		if (err) {
			console.error('Error destroying session:', err);
			return res.status(500).send('Internal Server Error');
		}

		// Clear the session cookie on the client
		res.clearCookie('session');
		return res.status(200).send('OK');
	});
});

const db = mysql.createConnection({
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME,
	waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
})

db.connect((err) => {
	
	if (err) {
		console.error('Error connecting to MySQL database:', err);
	} else {
		console.log('Connected to MySQL database');
	}
});

app.post('/signup', async (req, res) => {
	try {

		var encryptedPassword = cryptr.encrypt(req.body.password[0]);

		const sql1 = "INSERT INTO signup(`name`,`email`,`password`) VALUES (?)";
		const values = [req.body.name, req.body.email, encryptedPassword];
		await db.query(sql1, [values]);

		try {
			console.log("DONE")
			const sql = "SELECT * FROM signup WHERE `email` = ?";
			db.query(sql, [req.body.email], async (err, data) => {
				if (err) {
					console.log(err.message)
					return res.json({ error: err.message });
				}
				if (data.length > 0) {
						const useridTemp = data[0].id;
						userid = useridTemp
						console.log("Check from signup: " + userid)
						const sql3 = "INSERT INTO user_access(`userid`,`partycode`) VALUES (?, '{}')";
						const values = [useridTemp];
						await db.query(sql3, [values]);

						return res.json({ message: true });

				} else {
					return res.json({ message: false });
				}
			})

		} catch (error) {
			console.error(error.message);
			return res.json({ error: error.message });
		}

	} catch (error) {
		console.error(error.message);
		return res.json({ error: error.message });
	}
});

app.get('/', (req, res) => {

	if (req.session.username) {
		const sql = "SELECT partycode FROM user_access WHERE `userid` = ?";
		db.query(sql, userid, (err, data) => {
			if (err) {
				console.log(err.message);
				return res.json({ valid: false, error: err.message });
			}

			if (data.length > 0) {
				let codes = JSON.parse(data[0].partycode);
				const userCodes = Object.keys(codes); // Retrieve just the keys from the JSON object

				if (userCodes.length === 0) {
					return res.json({ valid: true, username: req.session.username, cookie: req.cookies, userCodes: [] });
				}

				const placeholders = Array.from({ length: userCodes.length }, (_, i) => '?').join(',');

				const sql = `SELECT partycode, title FROM albums WHERE \`partycode\` IN (${placeholders})`;
				db.query(sql, userCodes, (err, data) => {
					if (err) {
						return res.json({ valid: false, error: err.message });
					}
					if (data.length > 0) {
						const userCodesWithTitles = data.map(row => ({ title: row.title, partycode: row.partycode }));
						return res.json({ valid: true, username: req.session.username, cookie: req.cookies, userCodes: userCodesWithTitles });
					} else {
						return res.json({ valid: false });
					}
				});

			} else {
				res.clearCookie('connect.sid');
				return res.json({ valid: false });
			}
		});

	} else {
		res.clearCookie('connect.sid');
		return res.json({ valid: false });
	}


})

app.get('/getUserData', (req, res) => {

	const sql = "SELECT * FROM signup WHERE `id` = ?";
	console.log("Check: " + userid)
	db.query(sql, [userid], (err, data) => {
		console.log(data)
		if (err) {
			console.log(err.message)
			return res.json({ error: err.message });
		}
		if (data.length > 0) {
			console.log(data[0].id)
			console.log(data[0].name)

			return res.json({
				id: data[0].id,
				name: data[0].name
			});
		} else {
			return res.json({ message: false });
		}
	})
})

app.post('/login', (req, res) => {
	const sql = "SELECT * FROM signup WHERE `email` = ?";

	console.log(req.body.email, req.body.password)
	db.query(sql, [req.body.email], async (err, data) => {
		if (err) {
			console.log(err.message)
			return res.json({ error: err.message });
		}
		if (data.length > 0) {
			const decryptedPassword = cryptr.decrypt(data[0].password);
			if(decryptedPassword === req.body.password[0]) {
				console.log('true')
				req.session.username = data[0].name;
				req.session.userid = data[0].id;
				userid = req.session.userid;
				console.log(req.session.username);
				console.log(req.session.userid);
				res.cookie('session', 'cookieValue', { /* options */ });
				return res.json({ message: true, email: req.body.email, password: req.body.password, name: data[0].name,id: userid });
			} else {
				console.log("Incorrect Password")
				return res.json({ message: false });
			}
		} else {
			return res.json({ message: false });
		}
	})
})

app.post('/getImageList', (req, res) => {
	const { partycode } = req.body;
	// const userid = req.session.userid;

	if (!partycode || !userid) {
		return res.status(400).json({ error: 'Missing partycode or userid' });
	}

	const sql = "SELECT partycode FROM user_access WHERE `userid` = ?";
	db.query(sql, [userid], (err, data) => {
		if (err) {
			console.error(err.message);
			return res.status(500).json({ error: err.message });
		}
		if (data.length > 0) {
			let codes = JSON.parse(data[0].partycode);
			if (codes.hasOwnProperty(partycode)) {
				const images = codes[partycode];
				return res.status(200).json({ images });
			} else {
				return res.status(404).json({ error: 'Party code not found' });
			}
		} else {
			return res.status(404).json({ error: 'User not found' });
		}
	});
});

app.post('/addPartcodeForUser', async (req, res) => {
	console.log(req.body.partyCode);
	const partycode = req.body.partyCode;

	try {
		const response = await axios.post("https://38sglfeq52.execute-api.us-east-1.amazonaws.com/prod/compareFaces", null, {
			headers: {
				userid: userid,
				partycode: partycode
			}
		});
		const inputString = response.data
		const imageList = inputString.split("||||");
		console.log(imageList)


		const sql1 = "SELECT partycode FROM user_access WHERE `userid` = ?";
		db.query(sql1, [userid], (err, data) => {
			if (err) {
				console.error('MySQL query error:', err);
				res.status(500).json({ error: 'Internal Server Error' });
				return;
			}

			let partyCodeJSON = {};
			if (data.length > 0) {
				partyCodeJSON = JSON.parse(data[0].partycode || '{}');
			}

			partyCodeJSON[partycode] = imageList;

			const updatedPartyCodeString = JSON.stringify(partyCodeJSON);

			const sql2 = 'UPDATE user_access SET partycode=? WHERE userid=?;';
			db.query(sql2, [updatedPartyCodeString, userid], (err, result) => {
				if (err) {
					console.error('MySQL query error:', err);
					res.status(500).json({ error: 'Internal Server Error' });
					return;
				}

				console.log('Upload data inserted into MySQL');
				res.status(200).json({ message: 'Upload successful', user: userid });
			});
		});

	} catch (error) {
		res.status(500).json({ error: 'Error in getting matching images' });
		console.error("Error:", error);
	}

})

app.post('/upload', async (req, res) => {
	const { partyCode, title } = req.body;


	const sql = 'INSERT INTO albums (partyCode, title, date, owner) VALUES (?, ?, NOW(), ?)';

	if (userid != 0) {
		db.query(sql, [partyCode, title, userid], async (err, result) => {
			if (err) {
				console.error('MySQL query error:', err);
				res.status(500).json({ error: 'Internal Server Error' });
			} else {

				const sql2 = "SELECT partycode FROM user_access WHERE `userid` = ?";
				db.query(sql2, userid, async (err, data) => {
					if (err) {
						console.error('MySQL query error:', err);
						res.status(500).json({ error: 'Internal Server Error' });
					}
					if (data.length > 0) {
						let codes = JSON.parse(data[0].partycode) || {}

						try {
							const response = await axios.post("https://38sglfeq52.execute-api.us-east-1.amazonaws.com/prod/compareFaces", null, {
								headers: {
									userid: userid,
									partycode: partyCode
								}
							});
							const inputString = response.data
							const imageList = inputString.split("||||");
							// console.log(imageList)

							codes[partyCode] = imageList
							// console.log(codes)
							let codeString = JSON.stringify(codes)
							const sql3 = 'update user_access set partycode=? WHERE USERID=?;';
							if (userid != 0) {
								db.query(sql3, [codeString, userid], (err, result) => {
									if (err) {
										console.error('MySQL query error:', err);
										res.status(500).json({ error: 'Internal Server Error' });
									} else {
										console.log('Upload data inserted into MySQL');
										res.status(200).json({ message: 'Upload successful', user: userid });
									}
								});
							} else {
								res.status(401).json({ error: 'Unauthorized' });
							}
						} catch (error) {
							res.status(500).json({ error: 'Error in getting matching images' });
							console.error("Error:", error);
						}

					} else {
						console.error('MySQL query error:', err);
						res.status(500).json({ error: 'Internal Server Error' });
					}
				})
			}
		});
	} else {
		res.status(401).json({ error: 'Unauthorized' });
	}
});

// Route to handle user retrieval
app.get('/user', (req, res) => {
  const userId = req.query.id;
  const query = `SELECT * FROM signup WHERE id = ${userId}`;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error executing MySQL query:', err);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    if (results.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Return the user data as JSON
    res.json(results[0]);
  });
});


// Route to handle user update
app.put('/update', (req, res) => {
	const userId = req.query.id;
	const { name, email, password } = req.body;
  
	// Check if all required fields are provided
	if (!name || !email || !password) {
	  return res.status(400).json({ error: 'All fields are required' });
	}
  
	// Update the user data in the database
	const query = `UPDATE signup SET name = ?, email = ?, password = ? WHERE id = ?`;
	db.query(query, [name, email, password, userId], (err, result) => {
	  if (err) {
		console.error('Error executing MySQL query:', err);
		res.status(500).json({ error: 'Internal Server Error' });
		return;
	  }
  
	  // Check if the user was found and updated
	  if (result.affectedRows === 0) {
		res.status(404).json({ error: 'User not found' });
		return;
	  }
  
	  res.json({ message: 'User data updated successfully',valid: 'true' });
	});
  });
  

const port  = process.env.PORT || 8081

app.listen(port, () => {
	console.log('listening');
})