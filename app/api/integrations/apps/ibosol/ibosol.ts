//app/api/integrations/apps/ibosol/ibosol.ts
import * as cheerio from 'cheerio';

// Helper para o delay obrigatório de 2 segundos
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper para extrair cookies de uma resposta do fetch
function extractCookies(response: Response, currentCookies: string = ""): string {
    const setCookieHeader = response.headers.get('set-cookie');
    if (!setCookieHeader) return currentCookies;

    // Concatena novos cookies mantendo o formato string do header
    const newCookies = setCookieHeader.split(',').map(c => c.split(';')[0]).join('; ');
    return currentCookies ? `${currentCookies}; ${newCookies}` : newCookies;
}

export const IbosolAPI = {
    /**
     * ============================================================================
     * AÇÃO: CREATE (Adiciona Playlist e Busca Vencimento)
     * ============================================================================
     */
    async create(params: {
        baseUrl: string;
        appName: string;
        macValue: string;
        serverName: string;
        m3uUrl: string;
        password?: string;
    }) {
        try {
            const baseUrl = params.baseUrl.replace(/\/$/, "");
            const addUrl = `${baseUrl}/add-play-list`;
            let cookies = "";

            // 1. GET na página de Adicionar para pegar Tokens e o ID do App
            const getAddRes = await fetch(addUrl, { method: 'GET' });
            if (!getAddRes.ok) throw new Error(`Falha ao acessar ${addUrl}`);
            cookies = extractCookies(getAddRes, cookies);
            const addHtml = await getAddRes.text();
            
            const $add = cheerio.load(addHtml);
            
            // Procura o ID do produto baseado no texto
            let productId = "";
            $add('select#product option, select[name*="product"] option').each((_, el) => {
                if ($add(el).text().toLowerCase().includes(params.appName.toLowerCase())) {
                    productId = $add(el).attr('value') || "";
                }
            });

            if (!productId) throw new Error(`Aplicativo "${params.appName}" não encontrado na lista do painel.`);

            // Pega o token CSRF oculto (Laravel, CodeIgniter, etc usam muito isso)
            const csrfToken = $add('input[name="_token"]').val() || "";

            // Aguarda 2 segundos para não atropelar
            await delay(2000);

            // 2. Monta o Payload do POST
            // Nota: Os nomes dos campos são baseados nos seletores da sua extensão.
            const formData = new URLSearchParams();
            if (csrfToken) formData.append('_token', csrfToken.toString());
            formData.append('product', productId); // ou product_id dependendo do painel
            formData.append('mac_address', params.macValue);
            
            // Tenta adivinhar os nomes exatos dos campos baseados no HTML
            const nameField = $add('input[name*="name"]').attr('name') || 'name';
            const urlField = $add('input[name*="url"], input[name*="host"]').attr('name') || 'url';
            
            formData.append(nameField, params.serverName || "Playlist");
            formData.append(urlField, params.m3uUrl);

            const pin = (params.password || "").replace(/\D/g, "");
            if (pin && pin.length >= 4) {
                const pinCheckName = $add('input[type="checkbox"][name*="pin"]').attr('name') || 'pin_enable';
                const pinInputName = $add('input[name*="pin_code"], input[name="pin"]').attr('name') || 'pin_code';
                const pinConfirmName = $add('input[name*="pin_code_confirmation"], input[name*="confirm"]').attr('name') || 'pin_code_confirmation';
                
                formData.append(pinCheckName, 'on'); // Marca o checkbox
                formData.append(pinInputName, pin);
                formData.append(pinConfirmName, pin);
            }

            // Descobre para onde o form envia os dados
            const formActionAdd = $add('form').attr('action') || addUrl;

            // 3. POST para Adicionar Playlist
            const postAddRes = await fetch(formActionAdd, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': cookies,
                    'Referer': addUrl
                },
                body: formData.toString()
            });

            cookies = extractCookies(postAddRes, cookies);
            const postAddHtml = await postAddRes.text();
            
            // Verifica se deu erro na tela de retorno
            const $addRes = cheerio.load(postAddHtml);
            const errAlertAdd = $addRes('.invalid-feedback, .alert-danger, .text-red-600').text().trim();
            if (errAlertAdd && !errAlertAdd.toLowerCase().includes('expire')) {
                throw new Error(`Erro do painel: ${errAlertAdd}`);
            }

            await delay(2000);

            // ==========================================
            // 4. GET na página de Checar MAC
            // ==========================================
            const checkUrl = `${baseUrl}/check-mac`;
            const getCheckRes = await fetch(checkUrl, {
                headers: { 'Cookie': cookies }
            });
            cookies = extractCookies(getCheckRes, cookies);
            const checkHtml = await getCheckRes.text();
            const $check = cheerio.load(checkHtml);

            const csrfTokenCheck = $check('input[name="_token"]').val() || csrfToken;

            await delay(2000);

            // 5. POST para Checar MAC
            const formCheckData = new URLSearchParams();
            if (csrfTokenCheck) formCheckData.append('_token', csrfTokenCheck.toString());
            formCheckData.append('product', productId);
            formCheckData.append('mac_address', params.macValue);

            const formActionCheck = $check('form').attr('action') || checkUrl;

            const postCheckRes = await fetch(formActionCheck, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': cookies,
                    'Referer': checkUrl
                },
                body: formCheckData.toString()
            });

            const postCheckHtml = await postCheckRes.text();
            const $final = cheerio.load(postCheckHtml);

            // 6. Caçar a data de expiração no HTML de resposta
            let expireDate = "";
            
            // Extrai todo o texto da página e procura pelo padrão de data YYYY-MM-DD
            const bodyText = $final('body').text();
            const dateMatch = bodyText.match(/(\d{4}-\d{2}-\d{2})/);
            
            if (dateMatch && dateMatch[1]) {
                expireDate = dateMatch[1];
            } else {
                // Tenta buscar dentro de alertas de erro (ex: "MAC already activated until 2025-01-01")
                const errAlertCheck = $final('.invalid-feedback, .alert-danger, .text-red-600').text();
                const errMatch = errAlertCheck.match(/(\d{4}-\d{2}-\d{2})/);
                if (errMatch && errMatch[1]) {
                    expireDate = errMatch[1];
                }
            }

            return {
                ok: true,
                expireDate: expireDate || null,
                message: expireDate ? "Integrado com sucesso." : "Integrado, mas sem data localizada."
            };

        } catch (error: any) {
            return { ok: false, error: error.message || "Erro desconhecido na integração IBOSol." };
        }
    },

    /**
     * ============================================================================
     * AÇÃO: DELETE (Reset Playlist)
     * ============================================================================
     */
    async delete(params: {
        baseUrl: string;
        appName: string;
        macValue: string;
        deviceKey: string;
    }) {
        try {
            const baseUrl = params.baseUrl.replace(/\/$/, "");
            const resetUrl = `${baseUrl}/reset-playlist`;
            let cookies = "";

            // 1. GET na página
            const getRes = await fetch(resetUrl, { method: 'GET' });
            if (!getRes.ok) throw new Error(`Falha ao acessar ${resetUrl}`);
            cookies = extractCookies(getRes, cookies);
            const html = await getRes.text();
            const $ = cheerio.load(html);

            // Procura o ID do produto
            let productId = "";
            $('select#product option, select[name*="product"] option').each((_, el) => {
                if ($(el).text().toLowerCase().includes(params.appName.toLowerCase())) {
                    productId = $(el).attr('value') || "";
                }
            });

            if (!productId) throw new Error(`Aplicativo "${params.appName}" não encontrado.`);

            const csrfToken = $('input[name="_token"]').val() || "";
            const deviceKeyField = $('input[name="device_key"], input[id="device_key"]').attr('name') || 'device_key';

            await delay(2000);

            // 2. Monta o POST
            const formData = new URLSearchParams();
            if (csrfToken) formData.append('_token', csrfToken.toString());
            formData.append('product', productId);
            formData.append('mac_address', params.macValue);
            formData.append(deviceKeyField, params.deviceKey || "");

            const formAction = $('form').attr('action') || resetUrl;

            // 3. Executa o POST
            const postRes = await fetch(formAction, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': cookies,
                    'Referer': resetUrl
                },
                body: formData.toString()
            });

            const postHtml = await postRes.text();
            const $res = cheerio.load(postHtml);

            // Verifica sucesso ou erro
            const banner = $res('#session-message-banner').text().toLowerCase();
            const pageText = $res('body').text().toLowerCase();
            
            if (banner.includes('success') || pageText.includes('deleted successfully')) {
                return { ok: true };
            }

            const errAlert = $res('.invalid-feedback, .alert-danger, .text-red-600').text().trim();
            if (errAlert) {
                throw new Error(errAlert);
            }

            // Se não achou erro explícito, mas não confirmou sucesso, assume que deu certo (comportamento de alguns painéis)
            return { ok: true, note: "Comando enviado, validação heurística aplicada." };

        } catch (error: any) {
            return { ok: false, error: error.message || "Erro ao deletar no painel IBOSol." };
        }
    }
};