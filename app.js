'use strict';

const TelegramBotApi = require('telegram-bot-api');
const mongoose = require('mongoose');
const request = require('request-promise');
const config = require('./config');

mongoose.connect(config.db.url, {useNewUrlParser: true, useUnifiedTopology: true}, (err) => {
  if (err) {
    console.error('mongoose was unable to connect to mongodb');
    process.exit(1);
  }
  console.log('mongoose connection to mongodb is safe and sound');
});

const fixerSchema = new mongoose.Schema({
  date: {type: String, required: true},
  symbols: {type: Object, required: true},
  base: {type: String, required: true},
  rates: {type: Object, required: true}
});

fixerSchema.statics.refreshData = async function (date) {
  const fixer = {
    date,
    symbols: (await request.get({
      uri: `${config.fixer.url}/symbols`,
      qs: {
        access_key: config.fixer.accessKey
      },
      method: 'GET',
      json: true
    })).symbols
  };

  const {base, rates} = await request.get({
    uri: `${config.fixer.url}/${date}`,
    qs: {
      access_key: config.fixer.accessKey
    },
    method: 'GET',
    json: true
  });

  fixer.base = base;
  fixer.rates = rates;

  return new FixerModel(fixer).save();
};

fixerSchema.statics.getLatest = async function () {
  const date = getTodayDate();

  const fixer = await FixerModel.findOne({date}).exec();

  if (fixer) {
    return fixer;
  }

  return FixerModel.refreshData(date);
};

const FixerModel = mongoose.model('Fixer', fixerSchema);

const api = new TelegramBotApi({
  token: config.telegram.token, updates: {enabled: true}
});

async function startBot() {
  const failedToConvertMessage = 'Failed to convert.';
  let fixer = await FixerModel.getLatest();

  api.on('message', async (message) => {
    const replyMessage = {
      chat_id: message.chat.id,
      text: 'Try /help command.'
    };

    if (!message.entities ||
      message.entities.some(entity => entity.type === 'bot_command' && entity.offset) ||
      message.entities[0].type !== 'bot_command') {
      return await api.sendMessage(replyMessage);
    }

    const entities = message.entities.map(entity => message.text.substr(entity.offset, entity.length));

    switch (entities[0]) {
      case '/help': {
        replyMessage.text = 'List of available commands:\n' +
          '/help - usage info\n' +
          '/convert - convert currency using [TO FROM AMOUNT] format (i.e. convert USD EUR 100)\n\n' +
          'Inline query mode is available:\n' +
          'Try writing: @cnvtbot usd uah 250\n';
        break;
      }
      case '/convert': {
        const [from, to, amount] = message.text.substr('/convert'.length + 1).split(' ');
        
        const result = useConvert(fixer, from, to, amount);
        if (result) {
          replyMessage.text = formatResult(from, to, amount, result);
        }
        break;
      }
    }
    return await api.sendMessage(replyMessage);
  });

  api.on('inline.query', async (message) => {
    const date = getTodayDate();

    if (fixer.date !== date) {
      fixer = await FixerModel.refreshData(date);
    }

    const inlineQueryMessage = {
      inline_query_id: message.id,
      results: [{
        type: 'article',
        id: message.id,
        title: failedToConvertMessage,
        input_message_content: {
          message_text: failedToConvertMessage
        }
      }],
      cache_time: 0
    };

    let [from, to, amount] = message.query.split(' ');

    const result = useConvert(fixer, from, to, amount);
    if (!result) {
      return await api.answerInlineQuery(inlineQueryMessage);
    }

    const resultMessage = formatResult(from, to, amount, result);

    inlineQueryMessage.results[0].title = resultMessage;
    inlineQueryMessage.results[0].input_message_content.message_text = resultMessage;
    return await api.answerInlineQuery(inlineQueryMessage);
  });
}

const formatResult = (from, to, amount, result) => `${amount} ${from} is ${result} ${to}`

function useConvert(fixer, from, to, amount) {
  from = from && from.toUpperCase();
  to = to && to.toUpperCase();
  amount = Number(amount);

  if (!fixer.symbols[from] || !fixer.symbols[to] || !amount) {
    return;
  }

  const result = (from === fixer.base
    ? amount * fixer.rates[to]
    : amount / fixer.rates[from] * fixer.rates[to]).toFixed(2);
  return result;
}

function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  let month = now.getMonth() + 1;

  if (month < 10) {
    month = '0' + month;
  }

  let day = now.getDate();

  if (day < 10) {
    day = '0' + day;
  }

  return `${year}-${month}-${day}`;
}

startBot().catch(console.error);
