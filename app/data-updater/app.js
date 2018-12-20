const appInsights = require('applicationinsights');
const mongoose = require('mongoose');
const rp = require('request-promise');
const async = require('async');
const jsonResponse = require('./models/express/jsonResponse');

appInsights
  .setup()
  .setAutoDependencyCorrelation(true)
  .setAutoCollectRequests(true)
  .setAutoCollectPerformance(true)
  .setAutoCollectExceptions(true)
  .setAutoCollectDependencies(true)
  .setAutoCollectConsole(true)
  .setUseDiskRetryCaching(true)
  .start();

var telemetry = appInsights.defaultClient;

mongoose.set('useCreateIndex', true);
mongoose.set('useFindAndModify', false);

require('./models/mongo/flights');
require('./models/mongo/latestFlight');
require('./models/mongo/quakes');
require('./models/mongo/latestQuake');
require('./models/mongo/weather');
require('./models/mongo/latestWeather');

mongoose.Promise = global.Promise;

const Flights = mongoose.model('Flights');
const LatestFlight = mongoose.model('LatestFlight');
const Quakes = mongoose.model('Quakes');
const LatestQuake = mongoose.model('LatestQuake');
const Weather = mongoose.model('Weather');
const LatestWeather = mongoose.model('LatestWeather');

var mongoPrefix = "mongodb://"
var user = process.env.MONGODB_USER
var password = process.env.MONGODB_PASSWORD

var cosmosConnectString = mongoPrefix.concat(user,`:`,password,`@`,user,`.documents.azure.com:10255/hackfest?ssl=true`)

mongoose.connect(
    cosmosConnectString,
    {
      user: user,
      pass: password,
      useNewUrlParser: true
    }
  )

var db = mongoose.connection;

db.on('error', err => {
  appInsights.defaultClient.trackEvent({ name: 'MongoConnError' });
  console.log(err);
});

async.waterfall([
  function (cb) {
    db.once('open', () => {
      appInsights.defaultClient.trackEvent({ name: 'MongoConnSuccess' });
      console.log('connection success with Mongo');
      cb(null)
    });
  },
  function(cb) {
    telemetry.trackEvent({name: "opensky flights retrieval"})
    var opt = {
      uri: 'https://opensky-network.org/api/states/all',
      json: true
    };
  
    rp(opt)
      .then(data => {
        cb(null, data);
      })
      .catch(err => {
        handleError('error retrieving flights from opensky');
        cb(err, null);
      });
  },
  function (data, cb) {
    console.log(data.states.length, "flights sent to be coded")
    buildGeoJson (data.states, (err, flights) => {
        cb(null, flights)
      })
  }
],function (err, result) {
  console.log(result.length)
  process.exit(0)
});

  
/*Flights
  .find({"Timestamp":"1545169109655"})
  .limit(1)
  .exec((err, doc) => {
    if (err)
      handleError(
        ' func - getDataObjFromDb :: error retrieving data'
      );
    console.log('Currently have ', doc[0].FeatureCollection.length, ' flights');
    process.exit(0)
  });
  */

/* BUILD THE GEOJSON ELEMENTS FROM FLIGHTS */
function buildGeoJson(flights, cb) {
  var flightGeoJson = [];
  var includedCountries = ['United States', 'Canada', 'Mexico'];
  async.each(
    flights,
    (flight, callback) => {
      if (
        flight[8] ||
        flight[7] <= 0 ||
        flight[5] === null ||
        flight[1].toString().replace(/ /g, '') === '' ||
        flight[1].length <= 6 ||
        includedCountries.indexOf(flight[2]) === -1
      ) {
        callback();
      } else {
        /* create the GeoJSON feature for this flight */
        var feature = {
          type: 'Feature',
          properties: {
            FlightNumber: flight[1].toString().replace(/ /g, ''),
            Country: flight[2],
            Altitude: flight[7],
            AirSpeed: flight[9],
            Heading: flight[10]
          },
          geometry: {
            type: 'Point',
            coordinates: [flight[5], flight[6]]
          }
        };

        /* Add this flights GeoJSON to the array */
        flightGeoJson.push(feature);
        callback();
      }
    },
    err => {
      if (err) {
        cb(err, null);
      } else {
        cb(null, flightGeoJson);
      }
    }
  );
}

function handleError(message) {
    console.log(message);
    telemetry.trackException({ exception: message });
}