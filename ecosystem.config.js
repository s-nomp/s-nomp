module.exports = {
    /**
     * Application configuration section
     * http://pm2.keymetrics.io/docs/usage/application-declaration/
     */
    apps: [{
        name: 'site',
        script: 'init.js',
        node_args: '--max_old_space_size=2048',
        max_memory_restart : "4G",
        env_production: {
            NODE_ENV: 'production'
        }
    }]
}
