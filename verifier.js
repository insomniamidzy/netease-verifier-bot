const WebSocket = require('ws');
global.WebSocket = WebSocket;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// 1. 從 GitHub Actions 環境變數讀取安全資料
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

const orderId = process.env.ORDER_ID;
const orderNo = process.env.ORDER_NO;
const targetServer = process.env.TARGET_SERVER || '亞洲服'; // 預設給個防呆值
const targetUid = process.env.TARGET_UID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function startVerifier() {
    console.log(`[啟動審查] 接收到訂單 ${orderNo}，準備檢查 UID: ${targetUid}`);
    
    // 💡 雲端 Linux 伺服器必須加上 --no-sandbox 參數才能順利啟動隱形瀏覽器
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }); 
    const page = await browser.newPage();

    try {
        await page.goto('https://pay.neteasegames.com/identityv/topup', { waitUntil: 'networkidle2' });
        await sleep(2000);

        // 填入伺服器與 UID
        try {
            await page.waitForSelector('.bui-select-selector', { timeout: 10000 });
            await page.click('.bui-select-selector');
            await sleep(500);
            await page.type('.bui-select-selection-search-input', targetServer || '亞洲服', { delay: 100 });
            await sleep(500);
            await page.keyboard.press('Enter');
        } catch (e) {}

        await page.waitForSelector('input.bui-input.gc-input-pc', { visible: true, timeout: 15000 });
        await page.type('input.bui-input.gc-input-pc', targetUid, { delay: 50 });

        await page.waitForSelector('.privacy-wrap-pc label, .bui-checkbox-content', { visible: true });
        await page.click('.privacy-wrap-pc label, .bui-checkbox-content');
        await sleep(500);

        await page.waitForSelector('.userid-login-btn', { visible: true });
        await page.click('.userid-login-btn');

        // 📸 關鍵點 1：等候 5 秒讓網頁彈出結果，並立刻拍張照存證！
        await sleep(5000);
        await page.screenshot({ path: 'step1_after_login.png', fullPage: true });

        // 點擊商品 (對應你原本 Tampermonkey 的步驟)
        const targetProductImg = await page.$('img[alt="690エコー"]');
        if (targetProductImg) {
            await targetProductImg.click();
            await sleep(2000);
        }

        const topupBtn = await page.$('.topup-action .topup-btn');
        if (topupBtn) {
            await topupBtn.click();
            await sleep(3000);
        }

        // 📸 關鍵點 2：拍下點擊儲存後的畫面
        await page.screenshot({ path: 'step2_after_topup.png', fullPage: true });

        console.log(`[${targetUid}] 正在深度探測阻擋彈窗...`);
        
        let result = 'PASS';
        try {
            // 把等待時間拉長到 10 秒，確保彈窗若存在絕對抓得到
            await page.waitForSelector('#bui-confirm .bui-modal-content', { visible: true, timeout: 10000 });
            result = 'BLOCKED'; 
        } catch (e) {
            result = 'PASS'; 
        }

        // 📸 關鍵點 3：最終判定結果截圖
        await page.screenshot({ path: `final_${result}.png`, fullPage: true });
        await browser.close();

    } catch (error) {
        console.error(`[${targetUid}] 檢查過程發生錯誤：`, error);
        await browser.close();
    }
}

// GitHub Actions 啟動入口
startVerifier();