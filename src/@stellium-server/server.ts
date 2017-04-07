import * as rimraf from 'rimraf'
import * as logger from 'morgan'
import * as express from 'express'
import * as mongoose from 'mongoose'
import * as compression from 'compression'
import * as session from 'express-session'
import * as connectRedis from 'connect-redis'

// @stellium
import {ENV, CachePath} from '../@stellium-common'
import {ApplicationRouter} from '../@stellium-router'
import {ApiRouter} from '../@stellium-api'
import {ErrorsHandler} from './errors_handler'
import {ServerConfig} from './config.interface'
import {compileScripts} from "./compile_scripts";


const RedisStore = connectRedis(session)

export class ApplicationServer {


    app: express.Application = express()

    /**
     * Bootstrap the application.
     *
     * @class Server
     * @method bootstrap
     * @static
     */
    public static bootstrap(config?: ServerConfig): ApplicationServer {
        rimraf(CachePath, () => {
            compileScripts()
        })
        return new ApplicationServer(config)
    }


    constructor(config?: ServerConfig) {

        (<any>mongoose).Promise = global.Promise

        mongoose.connect('mongodb://localhost/'+config.database)

        this.configure()

        this._attachRoutes()
    }

    configure() {

        // enable gzip compression
        this.app.use(compression())
    }


    private _attachRoutes() {

        const app = this.app

        // Use logger in development mode
        if (DEVELOPMENT) app.use(logger('dev'))

        let _session = {
            secret: ENV.secret,
            resave: false,
            saveUninitialized: true,
            cookie: {},
            store: new RedisStore({}),
        }

        if (!DEVELOPMENT) {
            // required by node session
            app.set('trust proxy', 1) // trust first proxy
            _session.cookie['secure'] = true // serve secure cookies
        }

        app.use(session(_session))

        new ApiRouter(app)

        /**
         * TODO(important): Re-introduce ajax routes in stellium-router
         * @date - 25 Mar 2017
         * @time - 7:26 PM
         */
        // new AjaxRouter(app)
        
        // Template resource routes for dynamic pages
        new ApplicationRouter(app)

        // Error handler for 404 and 500
        new ErrorsHandler(app)
    }
}
