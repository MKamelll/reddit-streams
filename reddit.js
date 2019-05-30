//dependencies
const snoowrap = require('snoowrap');
const moment = require('moment');
const twit = require('twit');
const Cron = require('cron').CronJob;
const google = require('googleapis').google;
require('dotenv/config');

// create instance of reddit
const r = new snoowrap({
    userAgent: process.env.USER_AGENT,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    username: process.env.USER_NAME,
    password: process.env.PASSWORD
});

//create twitter instance
const T = new twit({
    consumer_key: process.env.CONSUMER_KEY,
    consumer_secret: process.env.CONSUMER_SECRET,
    access_token: process.env.ACCESS_TOKEN,
    access_token_secret: process.env.ACCESS_TOKEN_SECRET
});

// create google oauth
const oauth2Client = new google.auth.OAuth2(
    process.env.BLOGGER_ID,
    process.env.BLOGGER_SECRET,
    process.env.REDIRECT
);
oauth2Client.setCredentials({
    refresh_token: process.env.REFRESH_TOKEN
});

// create blogger instance
const blogger = google.blogger({
    version: "v3",
    auth: oauth2Client,
    params: {
        blogId: process.env.BLOG_ID
    }
});

// shedules
let j = new Cron({
    cronTime: '0 10,25,40,55 * * * *',
    onTick: () => {
        getPostId();
        return;        
    },
    start: true,
    timeZone: 'GMT'
});

let d = new Cron({
    cronTime: '0 0 0 * * *',
    onTick: () => {
        deletedPost();
        return;        
    },
    start: true,
    timeZone: 'GMT'
});

// get all available posts id
function getPostId() {
    // clue
    console.log('The Bot Started! ' + new Date());
    // get all posts ids
    r.getSubreddit('soccerstreams')
        .getNew()
        .map(post => post.id)
        .then(data => getTitle(data))
}


function getTitle(data) {
    // list of starting incoming data from getTitle
    let post = [];
    let counter = 0;
    // loop through all ids and get their titles
    for (let submission of data) {
        r.getSubmission(submission).title
            .then(title => {
                // clue
                counter += 1;
                // make sure to get only titles with [ then number
                if (/^\[\d/.test(title)) {
                    // to escape hour not found err
                    if (/\[\s?(\d{2})/.test(title) && /:?\.?(\d{2})\s?\w{3}?\s?\]/.test(title)) {
                        // make sure that the title time is within 15 minutes before and 5 after
                        let hr = title.match(/\[\s?(\d{2})/)[1];
                        let min = title.match(/:?\.?(\d{2})\s?\w{3}?\s?\]/)[1];
                        let now = moment().utcOffset('+0000'); // utc offset to GMT time
                        let endTime = moment().utcOffset('+0000').hour(hr).minute(min).add(5, 'minutes'); // match time
                        let startTime = moment().utcOffset('+0000').hour(hr).minute(min).subtract(15, 'minutes'); //start time 15 min before
                        if (now.isBetween(startTime, endTime)) {
                            console.log('found: ' + title);
                            return title;
                        }
                    }
                }
            })
            .then((title) => {
                if (title) {
                    // make an object for each post with their id and title and comments come later
                    post.push({
                        'id': submission,
                        'title': title,
                        'comments': new Array()
                    })
                    return post;
                }
            })
            .then(() => {
                // check if it have all ids corresponding titles to return only once
                if (counter === data.length) {
                    if (post.length !== 0) {
                        console.log('sent new data..');
                        removeEmpty(post);
                    } else {
                        console.log('no data available!');
                    }

                }
            })

    }

}


function removeEmpty(post) {
    // ready titles for comment fetch
    let cleanData = [];
    // counter
    let counter = 0;
    // make sure only string data comes through excluding emptys
    for (let i = 0; i < post.length; i++) {
        if (typeof (post[i]['title']) == 'string') {
            cleanData.push(post[i]);

        }
        counter += 1;
    }
    // once again to return only once finished
    if (counter === post.length) {
        getComments(cleanData);
    }
}


// comments from ids and modificaions on them
async function getComments(cleanData) {

    // make a counter to help return once to deal with sync and async parts
    let counter = 0;
    for (let i = 0; i < cleanData.length; i++) {
        // loop through ids of the clean data object returning comments of each id submission
        let comments = await r.getSubmission(cleanData[i]['id']).comments
        let comment;
        // comments come as an array of objects so loop through it for each id
        for (let commentOb of comments) {
            comment = commentOb.body;
            // check hd links starters with expressions
            if (/^\*\*?hd/i.test(comment) || /^\s?\[?\s?hd/i.test(comment)) {
                // get start and end index based on common http
                let startIndex = comment.indexOf('http');
                let endIndex = comment.indexOf(')');
                let link = comment.substring(startIndex, endIndex);
                // check if the result has an http in case some sympoles block the substring
                if (link.includes('http')) {
                    link = link.trim();
                    // push to the clean data which has the original comment array for each object
                    cleanData[i]['comments'].push('HD: ' + link);
                }
                // same thing for sd links
            } else if (/^\s?\[?\s?sd/i.test(comment) || /^\*\*?sd/i.test(comment)) {
                let startIndex = comment.indexOf('http');
                let endIndex = comment.indexOf(')');
                let link = comment.substring(startIndex, endIndex);
                if (link.includes('http')) {
                    link = link.trim();
                    // push to the clean data which has the original comment array for each object
                    cleanData[i]['comments'].push('SD: ' + link);

                }
                // same thing for 520p links
            } else if (/^\s?\[?\s?520/.test(comment) || /^\*\*?520/i.test(comment)) {
                let startIndex = comment.indexOf('http');
                let endIndex = comment.indexOf(')');
                let link = comment.substring(startIndex, endIndex);
                if (link.includes('http')) {
                    // to only get 20 links max for adfly to finish before the next schedule
                    link = link.trim();
                    // push to the clean data which has the original comment array for each object
                    cleanData[i]['comments'].push('520P: ' + link);
                }
            }


        }
        counter += 1;
        // check the finished counting of cleanData to return once
        if (counter === cleanData.length) {
            // milestone
            console.log('sent to blogger ' + cleanData.length + ' streams');
            // send to twitter
            blogging(cleanData);

        }

    }
}


// create a blog
async function blogging(cleanData) {
    // title and link pairs
    let tweets = [];
    // iterate cleanData with title and comments
    for (let element of cleanData) {
        // title
        let blogTitle = '🔴🔴 LIVE: ' + element['title'];
        // join by <br> for new line on blog
        let blogContent = element['comments'].join('<br>');
        // sleep for limit
        await sleep(10000);
        // add new post
        const res = await blogger.posts.insert({
            requestBody: {
                title: blogTitle,
                content: blogContent
            }
        });
        // make a tweet with blog title and link to blog
        tweets.push({
            'title': blogTitle,
            'url': res.data.url
        });
        // to return once
        if (tweets.length === cleanData.length) {
            // clue
            console.log('sent to twitter: ' + tweets.length + ' tweets')
            // next
            tweetIt(tweets);
        }
    }
}


// tweeting blogs links and title
async function tweetIt(tweets) {
    for (let tweet of tweets) {
        // sleep for not too quick
        await sleep(10000);
        // compose tweet
        let status = tweet['title'] + '\n' + tweet['url'];
        // send tweet
        T.post('statuses/update', { status: status }, (err, data, res) => {
            // check err
            if (err) throw err;
            // log for sure
            if (res.statusCode === 200) {
                console.log('tweeted');
            }
        })
    }
}


// delete all blog posts
async function deletedPost() {
    // clue
    console.log('Time To Delete! ' + new Date());
    // pages list
    let pages = [];
    // get first page posts
    async function firstPage() {
        // list
        const res = await blogger.posts.list();
        // push page that contain all posts in .data.items and that is an array
        pages.push(res);
        // check of page have a nextPageToken to fetch next page using it
        if (res.data.nextPageToken) {
            // call another function
            await followUp(res.data.nextPageToken);
        } else {
            return pages;
        }
    }
    async function followUp(token) {
        // no blog id as it's defined once in blogger instance
        const res = await blogger.posts.list({
            pageToken: token
        })
        // push to pages array
        pages.push(res);
        // checking again to call the same function to get a loop
        if (res.data.nextPageToken) {
            followUp(res.data.nextPageToken);
        } else {
            return pages;
        }
    }

    // await pages to be ready
    await firstPage();
    // clue
    let counter = 0;
    // iterate through pages array
    for (let page of pages) {
        // iterate each post in a page getting ids
        for (let post of page.data.items) {
            // sleep for api
            await sleep(5000);
            // count post number
            counter += 1;
            // delete each post id
            const res = await blogger.posts.delete({ postId: post.id });
            // clue
            console.log('this is post ' + post.id + ' number: ' + counter + ' status: ' + res.status);
        }

    }
}


// create sleep to limit adfly requests
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    })
}

