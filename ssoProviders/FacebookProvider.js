const jwt = require('jsonwebtoken');
const axios = require('axios');

class FacebookProvider {
    constructor(config) {
        this.config = config;
    }

    async verify(credential) {
        try {
            const response = await axios.get('https://graph.facebook.com/me', {
                params: {
                    fields: 'id,email,first_name,last_name,picture,locale',
                    access_token: credential
                }
            });
            const payload = response.data;

            if (payload.id) {
                const issuedAtTime = Math.floor(Date.now() / 1000);
                const tokenExpiration = issuedAtTime + (this.config.jwtTimeToLive || 3600);

                const jwtPayload = {
                    iss: this.config.baseURL,
                    sub: payload.id,
                    aud: this.config.baseURL,
                    iat: issuedAtTime,
                    exp: tokenExpiration,
                    email: payload.email || '',
                    given_name: payload.first_name || '',
                    family_name: payload.last_name || payload.first_name || '',
                    author: payload.id,
                    picture: payload.picture?.data?.url || '',
                    locale: payload.locale || 'en'
                };

                const token = jwt.sign(jwtPayload, this.config.jwtSecretKey);

                return { status: 'success', token, expires_in: tokenExpiration };
            }

            return { status: 'error', token: '', expires_in: '', message: 'Invalid Facebook token' };
        } catch (error) {
            console.error('Facebook verification error:', error.message);
            return { status: 'error', token: '', expires_in: '', message: 'Facebook verification failed' };
        }
    }
}

module.exports = FacebookProvider;