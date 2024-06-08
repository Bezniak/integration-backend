const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;


app.use(bodyParser.json());
app.use(cors());

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY;

const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

// Function to get or create a user in Jira
async function getOrCreateUser(email, username) {
    try {
        // Check if the user exists in Jira
        const userResponse = await axios.get(`${JIRA_BASE_URL}/rest/api/3/user/search?query=${email}`, {
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });

        if (userResponse.data.length === 0) {
            // Create a user in Jira
            const createUserResponse = await axios.post(`${JIRA_BASE_URL}/rest/api/3/user`, {
                emailAddress: email,
                products: ["jira-software"]
            }, {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json'
                }
            });
            return createUserResponse.data.accountId;
        } else {
            return userResponse.data[0].accountId;
        }
    } catch (error) {
        console.error('Error getting/creating user in Jira:', error.response ? error.response.data : error.message);
        throw new Error('Error getting/creating user in Jira');
    }
}

// Function to get priority id by its name
async function getPriorityIdByName(priorityName) {
    try {
        const priorityResponse = await axios.get(`${JIRA_BASE_URL}/rest/api/3/priority`, {
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });
        const priorityMap = priorityResponse.data.reduce((map, priority) => {
            map[priority.name.toLowerCase()] = priority.id;
            return map;
        }, {});
        if (!priorityMap[priorityName.toLowerCase()]) {
            throw new Error(`Priority '${priorityName}' is not valid`);
        }
        return priorityMap[priorityName.toLowerCase()];
    } catch (error) {
        console.error('Error getting priority ID:', error.response ? error.response.data : error.message);
        throw new Error('Error getting priority ID');
    }
}

app.post('/create-ticket', async (req, res) => {
    const {summary, priority, link, collection, user} = req.body;
    if (!summary || !priority || !link || !collection || !user) {
        return res.status(400).send('All fields are required');
    }
    try {
        // Get or create a user in Jira
        let reporterAccountId = await getOrCreateUser(user.email, user.username);
        // Get the priority identifier
        const priorityId = await getPriorityIdByName(priority);
        // Create a ticket
        const description = {
            type: "doc",
            version: 1,
            content: [
                {
                    type: "paragraph",
                    content: [
                        {type: "text", text: `Summary: ${summary}`},
                        {type: "hardBreak"},
                        {type: "text", text: `Priority: ${priority}`},
                        {type: "hardBreak"},
                        {type: "text", text: `Link: ${link}`},
                        {type: "hardBreak"},
                        {type: "text", text: `Collection: ${collection}`},
                        {type: "hardBreak"},
                        {type: "text", text: `Reported by: ${user.username}`}
                    ]
                }
            ]
        };
        const response = await axios.post(`${JIRA_BASE_URL}/rest/api/3/issue`, {
            fields: {
                project: {key: JIRA_PROJECT_KEY},
                summary,
                issuetype: {name: 'Integration'},
                priority: {id: priorityId},
                description,
                reporter: {accountId: reporterAccountId},
                customfield_10034: user.username,
                customfield_10035: collection,
                customfield_10036: link
            }
        }, {
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });
        res.json({issueKey: response.data.key, issueUrl: `${JIRA_BASE_URL}/browse/${response.data.key}`});
    } catch (error) {
        console.error('Error creating ticket:', error.response ? error.response.data : error.message);
        res.status(500).send('Error creating ticket');
    }
});

app.get('/tickets', async (req, res) => {
    const {reportedBy, startAt = 0, maxResults = 10} = req.query;
    try {
        const response = await axios.get(`${JIRA_BASE_URL}/rest/api/3/search`, {
            params: {
                jql: `reporter="${reportedBy}"`,
                fields: 'summary,status,priority,key,customfield_10044,customfield_10035',
                startAt,
                maxResults
            },
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });
        res.json({
            issues: response.data.issues,
            total: response.data.total,
            startAt: response.data.startAt,
            maxResults: response.data.maxResults
        });
    } catch (error) {
        console.error('Error fetching tickets:', error.response ? error.response.data : error.message);
        res.status(500).send('Error fetching tickets');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
