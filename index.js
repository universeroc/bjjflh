// Main script for scraping and saving data
import fetch from 'node-fetch';
import fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://fuwu.rsj.beijing.gov.cn/jfgs2025integralpublic/settlePerson';
const TABLE_URL = BASE_URL + '/tablePage';
const DETAILS_URL = BASE_URL + '/settlePersonDetails';

const HEADERS = {
  "accept": "text/html, */*; q=0.01",
  "accept-language": "zh-CN,zh;q=0.9",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "x-requested-with": "XMLHttpRequest",
  "cookie": "route=ad4d24fc13bbd546fe7f82bbdf8f2ddc; JSESSIONID=E5D532314ED9B3EEF9833555C02B09B7; 69867b41007d48a1bc1a8c080fe543d6=WyIxMTI5NjA1MTMyIl0; arialoadData=false; _yfx_session_sdzc=%7B%22_yfx_firsttime%22%3A%221752542963960%22%2C%22_yfx_lasttime%22%3A%221752542963960%22%2C%22_yfx_visittime%22%3A%221752542963960%22%2C%22_yfx_lastvisittime%22%3A%221752542975282%22%2C%22_yfx_domidgroup%22%3A%221752542963960%22%2C%22_yfx_domallsize%22%3A%22100%22%2C%22_yfx_cookie%22%3A%2220250715092923962439904307182531%22%7D",
  "Referer": "https://fuwu.rsj.beijing.gov.cn/jfgs2025integralpublic/settleperson/settlePersonTable"
};

async function fetchTable(page = 0, rows = 10) {
  const body = `name=&rows=${rows}&page=${page}`;
  const res = await fetch(TABLE_URL, {
    method: 'POST',
    headers: HEADERS,
    body
  });
  return await res.text();
}

async function fetchDetails(id) {
  const body = `id=${id}`;
  const res = await fetch(DETAILS_URL, {
    method: 'POST',
    headers: HEADERS,
    body
  });
  return await res.text();
}

function parseTable(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table.blue_table1 tbody tr').each((i, el) => {
    const tds = $(el).find('td');
    if (tds.length < 6) return; // skip malformed rows
    const 公示编号 = $(tds[0]).text().trim();
    const 姓名 = $(tds[1]).text().trim();
    const 出生年月 = $(tds[2]).text().trim();
    const 单位名称 = $(tds[3]).text().trim();
    const 积分分值 = $(tds[4]).text().trim();
    // Extract ID from 查看 link
    const viewLink = $(tds[5]).find('a').attr('onclick');
    let id = null;
    if (viewLink) {
      const match = viewLink.match(/showDetails\('([0-9]+)'\)/);
      if (match) id = match[1];
    }
    if (id) {
      rows.push({ id, 公示编号, 姓名, 出生年月, 单位名称, 积分分值 });
    }
  });
  return rows;
}

function parseDetails(html) {
  const $ = cheerio.load(html);
  const details = {};
  // Skip the header row, only process rows with at least 3 tds
  $('table.blue_table1 tr').each((i, el) => {
    const tds = $(el).find('td');
    if (tds.length >= 3) {
      const key = $(tds[1]).text().trim(); // 积分项目明细
      const value = $(tds[2]).text().trim(); // 分值
      if (key) details[key] = value;
    }
  });
  return details;
}

async function main() {
  const allRows = [];
  let page = 0;
  const rowsPerPage = 10;
  let hasMore = true;
  let columns = [];
  let detailKeys = new Set();

  while (hasMore) {
    console.log(`Fetching page ${page}...`);
    const html = await fetchTable(page, rowsPerPage);
    const rows = parseTable(html);
    if (rows.length === 0) break;
    for (const row of rows) {
      let details = {};
      if (row.id) {
        const detailHtml = await fetchDetails(row.id);
        details = parseDetails(detailHtml);
        Object.keys(details).forEach(k => detailKeys.add(k));
      }
      allRows.push({
        id: row.id,
        积分分值: row.积分分值,
        公示编号: row.公示编号,
        姓名: row.姓名,
        出生年月: row.出生年月,
        单位名称: row.单位名称,
        ...details
      });
    }
    page += rowsPerPage;
    hasMore = rows.length === rowsPerPage;
  }

  // Prepare CSV columns
  if (allRows.length > 0) {
    columns = [
      { id: 'id', title: 'ID' },
      { id: '积分分值', title: '积分分值' },
      ...Object.keys(allRows[0]).filter(k => k !== 'id' && k !== '积分分值').map(k => ({ id: k, title: k }))
    ];
    // Add detail keys as columns
    detailKeys.forEach(k => {
      if (!columns.find(col => col.id === k)) columns.push({ id: k, title: k });
    });
  }

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outputFile = `jfgs2025-${timestamp}.csv`;

  const csvWriter = createObjectCsvWriter({
    path: outputFile,
    header: columns
  });
  await csvWriter.writeRecords(allRows);
  console.log(`Data saved to ${outputFile}`);
}

main();
