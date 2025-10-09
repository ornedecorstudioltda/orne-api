// order-details.js - VERSÃO CORRIGIDA E INTEGRADA
// API para buscar detalhes completos de um pedido específico
// Última atualização: Janeiro 2025

export default async function handler(req, res) {
    // ============================
    // 1. CONFIGURAÇÃO DE CORS
    // ============================
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Cache por 1 minuto (detalhes mudam com mais frequência)
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    
    // Handle OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Só aceitar GET
    if (req.method !== 'GET') {
        return res.status(405).json({ 
            success: false,
            error: 'Método não permitido' 
        });
    }
    
    // ============================
    // 2. CONFIGURAÇÕES
    // ============================
    const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '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';
    const SHOP_DOMAIN = process.env.SHOP_DOMAIN || 'orne-decor-studio.myshopify.com';
    const API_VERSION = '2024-01';
    
    try {
        // ============================
        // 3. VALIDAR PARÂMETROS
        // ============================
        const { orderId } = req.query;
        
        if (!orderId) {
            return res.status(400).json({ 
                success: false,
                error: 'ID do pedido é obrigatório',
                message: 'Forneça o parâmetro orderId na URL'
            });
        }
        
        // Validar formato do ID (deve ser numérico)
        if (!/^\d+$/.test(orderId)) {
            return res.status(400).json({ 
                success: false,
                error: 'ID do pedido inválido',
                message: 'O ID deve conter apenas números'
            });
        }
        
        console.log(`📦 Buscando detalhes do pedido ${orderId}...`);
        
        // ============================
        // 4. BUSCAR PEDIDO NA SHOPIFY
        // ============================
        const shopifyUrl = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders/${orderId}.json`;
        
        const response = await fetch(shopifyUrl, {
            method: 'GET',
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        
        // Tratar erros da API
        if (!response.ok) {
            console.error(`❌ Erro Shopify: ${response.status}`);
            
            if (response.status === 404) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Pedido não encontrado',
                    message: `Não foi possível encontrar o pedido #${orderId}`
                });
            }
            
            if (response.status === 401) {
                return res.status(401).json({ 
                    success: false,
                    error: 'Não autorizado',
                    message: 'Token de acesso inválido'
                });
            }
            
            return res.status(response.status).json({ 
                success: false,
                error: `Erro ao buscar pedido: ${response.statusText}`,
                status_code: response.status
            });
        }
        
        const data = await response.json();
        const order = data.order;
        
        if (!order) {
            throw new Error('Resposta da API sem dados do pedido');
        }
        
        // ============================
        // 5. BUSCAR DADOS DO CLIENTE
        // ============================
        let customerData = {
            orders_count: 1,
            total_spent: order.total_price,
            created_at: order.created_at
        };
        
        if (order.customer && order.customer.id) {
            try {
                // Buscar histórico do cliente
                const customerUrl = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/customers/${order.customer.id}.json`;
                const customerResponse = await fetch(customerUrl, {
                    headers: {
                        'X-Shopify-Access-Token': SHOPIFY_TOKEN
                    }
                });
                
                if (customerResponse.ok) {
                    const customerInfo = await customerResponse.json();
                    if (customerInfo.customer) {
                        customerData = {
                            orders_count: customerInfo.customer.orders_count || 1,
                            total_spent: customerInfo.customer.total_spent || order.total_price,
                            created_at: customerInfo.customer.created_at || order.created_at,
                            tags: customerInfo.customer.tags || '',
                            note: customerInfo.customer.note || ''
                        };
                    }
                }
            } catch (error) {
                console.log('⚠️ Erro ao buscar dados do cliente:', error.message);
                // Continuar com dados básicos
            }
        }
        
        // ============================
        // 6. PROCESSAR TRACKING
        // ============================
        const trackingData = [];
        const trackingSet = new Set();
        
        // Processar fulfillments
        if (order.fulfillments && Array.isArray(order.fulfillments)) {
            order.fulfillments.forEach((fulfillment, index) => {
                // Dados do fulfillment
                const fulfillmentData = {
                    id: fulfillment.id,
                    status: fulfillment.status,
                    created_at: fulfillment.created_at,
                    updated_at: fulfillment.updated_at,
                    shipment_status: fulfillment.shipment_status || 'in_transit',
                    tracking_company: fulfillment.tracking_company || 'Transportadora',
                    tracking_numbers: [],
                    tracking_urls: []
                };
                
                // Coletar tracking numbers
                if (fulfillment.tracking_number && !trackingSet.has(fulfillment.tracking_number)) {
                    trackingSet.add(fulfillment.tracking_number);
                    fulfillmentData.tracking_numbers.push(fulfillment.tracking_number);
                    if (fulfillment.tracking_url) {
                        fulfillmentData.tracking_urls.push(fulfillment.tracking_url);
                    }
                }
                
                if (fulfillment.tracking_numbers && Array.isArray(fulfillment.tracking_numbers)) {
                    fulfillment.tracking_numbers.forEach((tn, idx) => {
                        if (tn && !trackingSet.has(tn)) {
                            trackingSet.add(tn);
                            fulfillmentData.tracking_numbers.push(tn);
                            if (fulfillment.tracking_urls && fulfillment.tracking_urls[idx]) {
                                fulfillmentData.tracking_urls.push(fulfillment.tracking_urls[idx]);
                            }
                        }
                    });
                }
                
                if (fulfillmentData.tracking_numbers.length > 0) {
                    trackingData.push(fulfillmentData);
                }
            });
        }
        
        // ============================
        // 7. PROCESSAR ALIEXPRESS
        // ============================
        let aliexpressData = {
            order_number: null,
            account_id: null,
            tracking_url: null
        };
        
        // Buscar nas notas do pedido
        if (order.note) {
            const noteLines = order.note.split('\n');
            noteLines.forEach(line => {
                // AliExpress Order
                if (line.toLowerCase().includes('aliexpress') && line.includes('#')) {
                    const match = line.match(/#?\s*(\d+)/);
                    if (match) {
                        aliexpressData.order_number = match[1];
                        aliexpressData.tracking_url = `https://trade.aliexpress.com/order_detail.htm?orderId=${match[1]}`;
                    }
                }
                // Account ID
                if (line.toLowerCase().includes('account')) {
                    const match = line.match(/br(\d+)/i);
                    if (match) {
                        aliexpressData.account_id = 'br' + match[1];
                    }
                }
            });
        }
        
        // ============================
        // 8. ANÁLISE DE PRAZO
        // ============================
        const createdDate = new Date(order.created_at);
        const now = new Date();
        const daysPassed = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
        
        // Determinar se está entregue
        let isDelivered = false;
        let deliveredAt = null;
        
        if (order.fulfillments && order.fulfillments.length > 0) {
            const deliveredFulfillment = order.fulfillments.find(f => 
                f.shipment_status === 'delivered' || f.status === 'delivered'
            );
            if (deliveredFulfillment) {
                isDelivered = true;
                deliveredAt = deliveredFulfillment.updated_at || deliveredFulfillment.created_at;
            }
        }
        
        // Verificar tags
        if (!isDelivered && order.tags) {
            const tagsLower = order.tags.toLowerCase();
            if (tagsLower.includes('entregue') || tagsLower.includes('delivered')) {
                isDelivered = true;
            }
        }
        
        // Calcular status do prazo
        const hasTracking = trackingData.length > 0;
        let prazoStatus = 'no_prazo';
        let urgencyLevel = 'normal';
        
        if (isDelivered) {
            prazoStatus = 'concluido';
            urgencyLevel = 'delivered';
        } else if (!hasTracking) {
            if (daysPassed > 7) {
                prazoStatus = 'aguardando_urgente';
                urgencyLevel = 'critical';
            } else if (daysPassed > 3) {
                prazoStatus = 'aguardando';
                urgencyLevel = 'medium';
            }
        } else {
            if (daysPassed > 21) {
                prazoStatus = 'critico';
                urgencyLevel = 'critical';
            } else if (daysPassed > 16) {
                prazoStatus = 'atrasado';
                urgencyLevel = 'high';
            } else if (daysPassed > 13) {
                prazoStatus = 'alerta';
                urgencyLevel = 'medium';
            }
        }
        
        // ============================
        // 9. PROCESSAR TIMELINE
        // ============================
        const timeline = [];
        
        // Pedido criado
        timeline.push({
            type: 'order_created',
            title: 'Pedido realizado',
            description: `Pedido ${order.name} criado`,
            date: order.created_at,
            status: 'completed'
        });
        
        // Pagamento
        if (order.financial_status === 'paid') {
            timeline.push({
                type: 'payment_confirmed',
                title: 'Pagamento confirmado',
                description: `Pagamento de ${order.total_price} ${order.currency} aprovado`,
                date: order.processed_at || order.created_at,
                status: 'completed'
            });
        }
        
        // Fulfillments
        if (order.fulfillments) {
            order.fulfillments.forEach(f => {
                if (f.status === 'success' || f.status === 'fulfilled') {
                    timeline.push({
                        type: 'order_shipped',
                        title: 'Pedido enviado',
                        description: f.tracking_company ? 
                            `Enviado via ${f.tracking_company}` : 'Pedido despachado',
                        date: f.created_at,
                        status: 'completed',
                        tracking_number: f.tracking_number
                    });
                }
                
                if (f.shipment_status === 'delivered') {
                    timeline.push({
                        type: 'order_delivered',
                        title: 'Pedido entregue',
                        description: 'Entrega confirmada',
                        date: f.updated_at || f.created_at,
                        status: 'completed'
                    });
                }
            });
        }
        
        // Ordenar timeline por data
        timeline.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // ============================
        // 10. CALCULAR TOTAIS
        // ============================
        const subtotal = parseFloat(order.subtotal_price || 0);
        const shipping = order.shipping_lines ? 
            order.shipping_lines.reduce((sum, line) => sum + parseFloat(line.price || 0), 0) : 0;
        const discount = parseFloat(order.total_discounts || 0);
        const tax = parseFloat(order.total_tax || 0);
        const total = parseFloat(order.total_price || 0);
        
        // ============================
        // 11. MONTAR RESPOSTA COMPLETA
        // ============================
        const processedOrder = {
            // Informações básicas
            id: order.id,
            order_number: order.order_number || order.name,
            name: order.name,
            email: order.email,
            phone: order.phone,
            created_at: order.created_at,
            updated_at: order.updated_at,
            processed_at: order.processed_at,
            closed_at: order.closed_at,
            cancelled_at: order.cancelled_at,
            
            // Status
            financial_status: order.financial_status || 'pending',
            fulfillment_status: order.fulfillment_status || 'unfulfilled',
            
            // Análise de prazo
            days_since_order: daysPassed,
            prazo_status: prazoStatus,
            urgency_level: urgencyLevel,
            is_delivered: isDelivered,
            delivered_at: deliveredAt,
            has_tracking: hasTracking,
            
            // Valores financeiros
            currency: order.currency || 'BRL',
            subtotal_price: subtotal.toFixed(2),
            total_shipping: shipping.toFixed(2),
            total_discounts: discount.toFixed(2),
            total_tax: tax.toFixed(2),
            total_price: total.toFixed(2),
            
            // Gateway de pagamento
            payment_gateway: order.gateway || order.payment_gateway_names?.join(', ') || 'N/A',
            
            // Cliente
            customer: order.customer ? {
                id: order.customer.id,
                email: order.customer.email || '',
                first_name: order.customer.first_name || '',
                last_name: order.customer.last_name || '',
                phone: order.customer.phone || '',
                orders_count: customerData.orders_count,
                total_spent: customerData.total_spent,
                customer_since: customerData.created_at,
                tags: customerData.tags,
                note: customerData.note
            } : null,
            
            // Endereço de entrega
            shipping_address: order.shipping_address ? {
                name: `${order.shipping_address.first_name || ''} ${order.shipping_address.last_name || ''}`.trim(),
                company: order.shipping_address.company || '', // Pode conter CPF/CNPJ
                address1: order.shipping_address.address1 || '',
                address2: order.shipping_address.address2 || '',
                city: order.shipping_address.city || '',
                province: order.shipping_address.province || '',
                province_code: order.shipping_address.province_code || '',
                country: order.shipping_address.country || 'Brasil',
                country_code: order.shipping_address.country_code || 'BR',
                zip: order.shipping_address.zip || '',
                phone: order.shipping_address.phone || '',
                latitude: order.shipping_address.latitude,
                longitude: order.shipping_address.longitude
            } : null,
            
            // Endereço de cobrança
            billing_address: order.billing_address ? {
                name: `${order.billing_address.first_name || ''} ${order.billing_address.last_name || ''}`.trim(),
                company: order.billing_address.company || '',
                address1: order.billing_address.address1 || '',
                address2: order.billing_address.address2 || '',
                city: order.billing_address.city || '',
                province: order.billing_address.province || '',
                province_code: order.billing_address.province_code || '',
                country: order.billing_address.country || 'Brasil',
                zip: order.billing_address.zip || '',
                phone: order.billing_address.phone || ''
            } : null,
            
            // Produtos
            line_items: order.line_items ? order.line_items.map(item => ({
                id: item.id,
                product_id: item.product_id,
                variant_id: item.variant_id,
                title: item.title || 'Produto',
                variant_title: item.variant_title || '',
                sku: item.sku || '',
                vendor: item.vendor || '',
                quantity: item.quantity || 1,
                price: parseFloat(item.price || 0).toFixed(2),
                total_discount: parseFloat(item.total_discount || 0).toFixed(2),
                properties: item.properties || [],
                requires_shipping: item.requires_shipping !== false,
                taxable: item.taxable !== false,
                gift_card: item.gift_card === true,
                name: item.name || item.title,
                fulfillment_status: item.fulfillment_status
            })) : [],
            
            // Rastreamento detalhado
            tracking_info: trackingData,
            tracking_numbers: Array.from(trackingSet), // Array único de trackings
            
            // Cupons de desconto
            discount_codes: order.discount_codes || [],
            discount_applications: order.discount_applications || [],
            
            // Informações de envio
            shipping_lines: order.shipping_lines ? order.shipping_lines.map(s => ({
                id: s.id,
                title: s.title || 'Frete',
                price: parseFloat(s.price || 0).toFixed(2),
                code: s.code || '',
                source: s.source || '',
                carrier_identifier: s.carrier_identifier,
                requested_fulfillment_service_id: s.requested_fulfillment_service_id
            })) : [],
            
            // Taxas
            tax_lines: order.tax_lines || [],
            
            // Tags e notas
            tags: order.tags || '',
            note: order.note || '',
            note_attributes: order.note_attributes || [],
            
            // Timeline de eventos
            timeline: timeline,
            
            // Informações adicionais
            browser_ip: order.browser_ip,
            landing_site: order.landing_site,
            referring_site: order.referring_site,
            source_name: order.source_name || 'web',
            source_identifier: order.source_identifier,
            source_url: order.source_url,
            
            // Carrinho
            cart_token: order.cart_token,
            checkout_token: order.checkout_token,
            checkout_id: order.checkout_id,
            
            // AliExpress
            aliexpress: aliexpressData,
            
            // Informações extras para compatibilidade
            additional_info: {
                gateway: order.gateway || 'N/A',
                processing_method: order.processing_method || 'manual',
                app_id: order.app_id,
                location_id: order.location_id,
                user_id: order.user_id,
                order_status_url: order.order_status_url
            }
        };
        
        console.log(`✅ Pedido ${orderId} processado com sucesso`);
        
        // ============================
        // 12. RETORNAR RESPOSTA
        // ============================
        return res.status(200).json({
            success: true,
            order: processedOrder,
            metadata: {
                version: '2.0',
                generated_at: new Date().toISOString(),
                cache_duration: 60
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao processar pedido:', error);
        console.error(error.stack);
        
        return res.status(500).json({ 
            success: false,
            error: 'Erro ao processar pedido',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
