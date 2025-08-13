// ./ssoProviders/XProvider.js
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');

class XProvider {
    constructor(config) {
        this.config = config;
    }

    async verify(accessToken) {
        try {
            const response = await axios.get('https://api.twitter.com/2/users/me', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    'user.fields': 'id,username,name,profile_image_url'
                }
            });

            const userData = response.data.data;
            if (!userData) {
                return { 
                    status: 'error', 
                    token: '', 
                    expires_in: '',
                    error: 'No user data returned from X API'
                };
            }

            const issuedAtTime = Math.floor(Date.now() / 1000);
            const tokenExpiration = issuedAtTime + (this.config.jwtTimeToLive || 3600 * 48);

            const jwtPayload = {
                iss: this.config.baseURL,
                sub: userData.id,
                aud: this.config.baseURL,
                iat: issuedAtTime,
                exp: tokenExpiration,
                email: userData.username + '@x.placeholder.com',
                given_name: userData.name.split(' ')[0] || userData.username,
                family_name: userData.name.split(' ').slice(1).join(' ') || userData.username,
                picture: userData.profile_image_url || '',
                locale: 'en',
                author: crypto.createHash('sha256').update(userData.id).digest('hex')
            };

            const token = jwt.sign(jwtPayload, this.config.jwtSecretKey);

            return { 
                status: 'success', 
                token, 
                expires_in: tokenExpiration 
            };
        } catch (error) {
            console.error('X verification error:', error.message);
            return { 
                status: 'error', 
                token: '', 
                expires_in: '',
                error: error.message 
            };
        }
    }
}

module.exports = XProvider;