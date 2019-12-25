'use strict';

module.exports = {
  db: {
    url: 'mongodb://127.0.0.1/cnvtbot'
  },
  telegram: {
    token: process.env.TELEGRAM_TOKEN
  },
  fixer: {
    accessKey: process.env.FIXER_ACCESS_KEY,
    url: 'http://data.fixer.io/api'
  }
};
