#! /usr/bin/env node
/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements a simple STOMP client that listens for messages on a
/// given topic and prints them out to the console.
/// @author Russell Klenk (russ@ninjabirdstudios.com)
///////////////////////////////////////////////////////////////////////////80*/
var Filesystem  = require('fs');
var Path        = require('path');
var Program     = require('commander');
var STOMP       = require('../index');

/// Default application configuration values.
var defaults    = {
    /// The name of the application configuration file to load.
    CONFIG_FILENAME     : 'sub.json',
    /// The default name of the message broker/virtual host.
    BROKER_NAME         : 'localhost',
    /// The default hostname or IP address of the message broker.
    HOST_NAME           : 'localhost',
    /// The default port number on which the message broker is listening.
    HOST_PORT           : 61613,
    /// The default username used to login to the message broker.
    USER_NAME           : 'admin',
    /// The default password used to login to the message broker.
    USER_PASSWORD       : 'password',
    /// An array of strings representing the topics to subscribe to.
    TOPIC_NAMES         : []
};

/// Constants and global values used throughout the application module.
var application = {
    /// The name of the application module.
    NAME                : 'sub',
    /// The path from which the application was started.
    STARTUP_DIRECTORY   : process.cwd(),
    /// An object defining the pre-digested command-line arguments passed to
    /// the application, not including the node or script name values.
    args                : {},
    /// An object representing our primary connection to the message bus.
    connector           : null,
    /// Set to true when the application begins its shutdown process.
    didShutdown         : false
};

/// Constants defining the application exit codes.
var exit_code   = {
    /// The application exited normally, with no errors.
    SUCCESS             : 0,
    /// A connection error has occurred.
    CONNECTION_ERROR    : 1,
    /// The credentials used to log in to the broker are invalid.
    BAD_CREDENTIALS     : 2,
    /// The application exited with a generic error.
    ERROR               : 255
};

/// A handy utility function that prevents having to write the same obnoxious
/// code everytime. The typical javascript '||' trick works for strings,
/// arrays and objects, but it doesn't work for booleans or integers, because
/// both 'false' and '0' evaluate as falsey.
/// @param value The value to test.
/// @param theDefault The value to return if @a value is undefined.
/// @return Either @a value or @a theDefault (if @a value is undefined.)
function defaultValue(value, theDefault)
{
    return (value !== undefined) ? value : theDefault;
}

/// Determines whether a particular filesystem entry exists, and whether it
/// represents a file (as opposed to a directory, etc.)
/// @param path The path of the file to check.
/// @return true if @a path specifies an existing file, or false otherwise.
function isExistingFile(path)
{
    try
    {
        var    stat = Filesystem.statSync(path);
        return stat.isFile();
    }
    catch (error)
    {
        return false;
    }
}

/// Generates an object specifying the default application configuration.
/// @return An object initialized with the default application configuration.
function defaultConfiguration()
{
    var appConfig        = {};
    appConfig.brokerName = defaults.BROKER_NAME;
    appConfig.hostname   = defaults.HOST_NAME;
    appConfig.port       = defaults.HOST_PORT;
    appConfig.user       = defaults.USER_NAME;
    appConfig.password   = defaults.USER_PASSWORD;
    appConfig.topicNames = defaults.TOPIC_NAMES;
    return appConfig;
}

/// Writes an application configuration object out to a file.
/// @param config An object representing the application configuration to save.
/// @param filename The path of the configuration file to write. Defaults to
/// the file defaults.CONFIG_FILENAME in the current working directory.
/// @param silent Specify true to suppress any warning console output.
function saveConfiguration(config, filename, silent)
{
    try
    {
        config    = config   || defaultConfiguration();
        filename  = filename || defaults.CONFIG_FILENAME;
        var data  = JSON.stringify(config, null, '\t');
        Filesystem.writeFileSync(filename, data +'\n', 'utf8');
    }
    catch (error)
    {
        if (!silent) // @note: this is non-fatal
        {
            console.warn('Warning: Could not save application configuration:');
            console.warn('  with path: '+filename);
            console.warn('  exception: '+error);
            console.warn();
        }
    }
}

/// Attempts to load a configuration file containing application settings. If
/// the file cannot be loaded, the default configuration is returned.
/// @param filename The path of the configuration file to load. Defaults to
/// the file defaults.CONFIG_FILENAME in the current working directory.
/// @param silent Specify true to suppress any warning console output.
/// @return An object containing startup configuration properties.
function loadConfiguration(filename, silent)
{
    try
    {
        filename  = filename || defaults.CONFIG_FILENAME;
        var data  = Filesystem.readFileSync(filename, 'utf8');
        return JSON.parse(data);
    }
    catch (error)
    {
        if (!silent)
        {
            console.warn('Warning: Could not load application configuration:');
            console.warn('  with path: '+filename);
            console.warn('  exception: '+error);
            console.warn('The default application configuration will be used.');
            console.warn();
        }
        return defaultConfiguration();
    }
}

/// Parses command-line options, displays help if necessary and performs any
/// other setup in preparation for program execution.
function programStartup()
{
    // parse the command line, display help, etc. if the command
    // line is invalid, commander.js calls process.exit() for us.
    Program
        .version('1.0.0')
        .option('-h, --host [hostname]',  'Specify the broker hostname or IP.',              String)
        .option('-p, --port [number]',    'Specify the broker STOMP port.',                  Number)
        .option('-b, --broker [name]',    'Specify the name of the message broker.',         String)
        .option('-u, --user [name]',      'Specify the username used for authentication.',   String)
        .option('-c, --credentials [pw]', 'Specify the password used for authentication.',   String)
        .option('-t, --topics [name]',    'Comma-delimited list of topics to subscribe to.', String)
        .option('-s, --silent',           'Run in silent mode (no console output).')
        .option('-S, --save-config',      'Save the current application configuration.')
        .parse(process.argv);

    var configPath = Path.join(process.cwd(), defaults.CONFIG_FILENAME);
    var configData = loadConfiguration(configPath, Program.silent);

    // if no configuration file exists in the working directory, always save
    // out the stompsc.json file containing the current configuration.
    if (!isExistingFile(configPath))
    {
        Program.saveConfig = true;
    }

    // fill in unspecified command-line arguments with values
    // from the application configuration configuration file.
    // otherwise, override the config data from the command line.
    if  (Program.host)    configData.hostname = Program.host;
    else Program.host   = configData.hostname;

    if  (Program.port)    configData.port = Program.port;
    else Program.port   = configData.port;

    if  (Program.user)    configData.user = Program.user;
    else Program.user   = configData.user;

    if  (Program.broker)  configData.brokerName = Program.broker;
    else Program.broker = configData.brokerName;

    if  (Program.credentials)  configData.password = Program.credentials;
    else Program.credentials = configData.password;

    if  (Program.topics)
    {
        // convert from a comma-delimited list to an array.
        var topics = Program.topics.split(',');
        for (var i = 0, n =  topics.length; i < n; ++i)
        {
            topics[i] = topics[i].trim();
        }
        Program.topics        = topics;
        configData.topicNames = topics;
    }
    else Program.topics = configData.topicNames;

    // write out the application configuration if desired, or if none
    // had existed previously, so the user doesn't have to re-type
    // the command line parameters every time they run.
    if (Program.saveConfig)
        saveConfiguration(configData, configPath, Program.silent);

    // print out the application header and echo the current configuration.
    if (!Program.silent)
    {
        console.log('STOMPsub');
        console.log('Subscribe to STOMP topic(s) and echo received messages.');
        console.log('Press Ctrl-C at any time to disconnect and exit.')
        console.log();
        console.log('Configuration: ');
        console.log('  Host IP:     '+Program.host);
        console.log('  Host Port:   '+Program.port);
        console.log('  Broker Name: '+Program.broker);
        console.log('  Username:    '+Program.user);
        console.log('  Password:    '+Program.credentials);
        console.log('  Topics:      ');
        for (var i = 0, n = Program.topics.length; i < n; ++i)
            console.log('    '+Program.topics[i]);
        console.log();
    }

    // generate an object containing the final command-line arguments:
    application.args = {
        silent   : Program.silent,
        hostname : Program.host,
        port     : Program.port,
        broker   : Program.broker,
        topics   : Program.topics,
        username : Program.user,
        password : Program.credentials,
        unknown  : Program.args
    };
}

/// Displays an error message and exits. If any database connection is open,
/// it is closed. This function is suitable for use as a callback method or
/// for direct calls.
/// @param error Information about the error that occurred. Error information
/// is printed only if the application is not started in silent mode.
/// @param [exitCode] The process exit code. The default exit code is '1'.
function programError(error, exitCode)
{
    if (!application.args.silent)
    {
        error = error || '(no information)';
        console.error('An error occurred: '+error);
        console.error();
    }
    process.exit(defaultValue(exitCode, exit_code.ERROR));
}

/// Callback invoked when the STOMP ClientConnector reports an error during
/// the physical connection attempt.
/// @param connector The STOMP ClientConnector that raised the event.
/// @param errorInfo An Error instance or string specifying additional
/// information about the error.
function onConnectionError(connector, errorInfo)
{
    programError(errorInfo, exit_code.CONNECTION_ERROR);
}

/// Callback invoked when the STOMP ClientConnector receives an ERROR frame
/// in response to a CONNECT frame. This typically occurs because the client
/// credentials are invalid.
/// @param connector The STOMP ClientConnector that raised the event.
function onConnectionRejected(connector)
{
    programError('Invalid credentials.', exit_code.BAD_CREDENTIALS);
}

/// Callback invoked when the STOMP ClientConnector detects that the connection
/// to the message broker has been lost, either because the socket was closed
/// intentionally by the client, or because an error occurred and one end
/// aborted the connection.
/// @param connector The STOMP ClientConnector that raised the event.
function onDisconnect(connector, graceful)
{
    if (!application.args.silent)
    {
        console.log('Disconnected. [graceful = '+graceful+']');
        console.log();
    }
    process.exit(exit_code.SUCCESS);
}

/// Callback invoked when the STOMP ClientConnector receives a complete STOMP
/// message frame. This callback receives both system messages (like CONNECTED)
/// and user messages (the MESSAGE frame).
/// @param connector The STOMP ClientConnector that raised the event.
/// @param frame The STOMP Frame object that can be used to inspect and
/// manipulate the received message.
function onMessage(connector, frame)
{
    // print out the entire buffer.
    var buffer = frame.toBuffer();
    console.log(buffer.toString('utf8'));
    console.log();

    // if this is a JSON object, then decode it.
    var bodyInfo = frame.determineContentType();
    if (bodyInfo.mimeType === 'text/json')
    {
        var obj  = frame.getObjectFromBody();
        var json = JSON.stringify(obj, null, '\t');
        console.log('Decoded JSON body:');
        console.log(json);
        console.log();
    }
}

/// Callback invoked after the connection is successfully established and the
/// client has logged in. Any required subscriptions should be registered here.
/// Additional subscriptions can be registered at any time.
/// @param connector The STOMP ClientConnector that raised the event.
function onSubscribe(connector)
{
    var silent = application.args.silent;
    var topics = application.args.topics;
    for (var i = 0, n = topics.length; i < n; ++i)
    {
        var fr = connector.createSubscribe(i, topics[i]);
        connector.send(fr);
        if (!silent)
        {
            console.log('Subscribing to \''+topics[i]+'\' with id = '+i+'.');
        }
    }
    if (!silent) console.log();
}

/// Callback invoked to report that the connector is ready for use. This event
/// is raised immediately after the 'subscribe' handlers have executed.
/// @param connector The STOMP ClientConnector that raised the event.
function onConnectionReady(connector)
{
    if (!application.args.silent)
    {
        console.log('Ready.');
        console.log();
    }
}

/// Implements the primary logic of the application. This function is called
/// after command-line arguments have been parsed.
function programExecute()
{
    // create our message bus connector and connect.
    var connector            = new STOMP.ClientConnector();
    application.connector    = connector;
    connector.broker         = application.args.broker;
    connector.username       = application.args.username;
    connector.password       = application.args.password;
    connector.hostname       = application.args.hostname;
    connector.port           = application.args.port;
    connector.on('error',      onConnectionError);
    connector.on('rejected',   onConnectionRejected);
    connector.on('message',    onMessage);
    connector.on('subscribe',  onSubscribe);
    connector.on('ready',      onConnectionReady);
    connector.on('disconnect', onDisconnect);
    connector.connect();
}

/// Handle Ctrl-C signals from the user.
process.on('SIGINT', function ()
    {
        if (!application.args.silent)
        {
            console.log('Connector shutting down...');
        }
        application.connector.disconnect(true);
    });

/// Implements the entry point of the application.
function main()
{
    programStartup();
    programExecute();
}

// entry point: call our main function:
main();
