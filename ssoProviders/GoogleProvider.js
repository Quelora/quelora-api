// ./ssoProviders/GoogleProvider.js
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
//clientSecretCipher
class GoogleProvider {
    constructor(config) {
        this.client = new OAuth2Client(config.googleClientId);
        this.config = config;
    }

    async verify(credential) {
        try {
            
            const ticket = await this.client.verifyIdToken({ 
                idToken: credential, 
                audience: this.config.googleClientId 
            });

            const payload = ticket.getPayload();
            if (payload) {
                const issuedAtTime = Math.floor(Date.now() / 1000);
                const tokenExpiration = issuedAtTime + (this.config.jwtTimeToLive || 3600 * 48); 
                
                const jwtPayload = {
                    iss: this.config.baseURL,
                    sub: payload.sub,
                    aud: this.config.baseURL,
                    iat: issuedAtTime,
                    exp: tokenExpiration,
                    email: payload.email,
                    given_name: payload.given_name,
                    family_name: payload.family_name || payload.given_name,
                    author: payload.sub,
                    picture: payload.picture || '',
                    locale: payload.locale || 'en'
                };

                const token = jwt.sign(jwtPayload, this.config.jwtSecretKey);
                
                return { 
                    status: 'success', 
                    token, 
                    expires_in: tokenExpiration 
                };
            }
            return { 
                status: 'error', 
                token: '', 
                expires_in: '' 
            };
        } catch (error) {
            return { 
                status: 'error', 
                token: '', 
                expires_in: '',
                error: error.message 
            };
        }
    }
}

module.exports = GoogleProvider;