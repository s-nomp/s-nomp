/*
Copyright 2021 Cyber Pool (cyberpool.org)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

var net = require('net');
var defaultPort = 17117;
var defaultHost = '127.0.0.1';
var args = process.argv.slice(2);
var params = [];
var options = {};

for(var i = 0; i < args.length; i++) {
	if (args[i].indexOf('-') === 0 && args[i].indexOf('=') !== -1) {
		var s = args[i].substr(1).split('=');
		options[s[0]] = s[1];
	}
	else
	params.push(args[i]);
}
var command = params.shift();
var client = net.connect(options.port || defaultPort, options.host || defaultHost, function () {
	client.write(JSON.stringify({
		command: command,
		params: params,
		options: options
	}) + '\n');
}).on('error', function(error)	{
	if (error.code === 'ECONNREFUSED')
	console.log('Could not connect to NOMP instance at ' + defaultHost + ':' + defaultPort);
	else
	console.log('Socket error ' + JSON.stringify(error));
}).on('data', function(data) {
}).on('close', function () {
});

