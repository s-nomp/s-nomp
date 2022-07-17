Bug: Testnet only works with addresses that start with `n`

# Usage

#### 1) Downloading & Installing
ravencoin testnet node install script:
```bash
wget https://raw.githubusercontent.com/Seal-Clubber/s-nomp/master/ravencore-testnet.sh
chmod -R +x ravencore-testnet.sh
./ravencore-testnet.sh
```
run with:
`./raven/bin/raven-qt`

install script:
```bash
wget https://raw.githubusercontent.com/Seal-Clubber/s-nomp/master/install-rvn.sh
chmod -R +x install-rvn.sh
./install-rvn.sh
```

Or manually clone the repository and run `npm update` for all the dependencies to be installed:

```bash
sudo apt-get install build-essential libsodium-dev npm libboost-all-dev
sudo npm install n -g
sudo n stable
git clone https://github.com/s-nomp/s-nomp.git s-nomp
cd s-nomp
npm update
npm install

#npm install sha3
#npm install logger
#npm install bignum

```

##### Pool config
Take a look at the example json file inside the `pool_configs` directory. Rename it to `zclassic.json` and change the
example fields to fit your setup.

```
Please Note that: 1 Difficulty is actually 8192, 0.125 Difficulty is actually 1024.

Whenever a miner submits a share, the pool counts the difficulty and keeps adding them as the shares. 

ie: Miner 1 mines at 0.1 difficulty and finds 10 shares, the pool sees it as 1 share. Miner 2 mines at 0.5 difficulty and finds 5 shares, the pool sees it as 2.5 shares. 
```


##### [Optional, recommended] Setting up blocknotify
1. In `config.json` set the port and password for `blockNotifyListener`
2. In your daemon conf file set the `blocknotify` command to use:
```
node [path to cli.js] [coin name in config] [block hash symbol]
```
Example: inside `zclassic.conf` add the line
```
blocknotify=node /home/pool/s-nomp/scripts/cli.js blocknotify ravencoin %s
```

Alternatively, you can use a more efficient block notify script written in pure C. Build and usage instructions
are commented in [scripts/blocknotify.c](scripts/blocknotify.c).

```
blocknotify=/home/pool/s-nomp/scripts/blocknotify 127.0.0.1:17117 ravencoin %s
```
also set `"blockRefreshInterval": 500,` to `0` in `s-nomp/config.json`


#### 3) Start the portal

```bash
node init.js
```

#### warn
[**Redis security warning**](http://redis.io/topics/security): be sure firewall access to redis - an easy way is to
include `bind 127.0.0.1` in your `redis.conf` file. Also it's a good idea to learn about and understand software that
you are using - a good place to start with redis is [data persistence](http://redis.io/topics/persistence).

###### Optional enhancements for your awesome new mining pool server setup:
* Use something like [forever](https://github.com/nodejitsu/forever) to keep the node script running
in case the master process crashes. 
* Use something like [redis-commander](https://github.com/joeferner/redis-commander) to have a nice GUI
for exploring your redis database.
* Use something like [logrotator](http://www.thegeekstuff.com/2010/07/logrotate-examples/) to rotate log 
output from s-nomp.
* Use [New Relic](http://newrelic.com/) to monitor your s-nomp instance and server performance.


#### Upgrading s-nomp
When updating s-nomp to the latest code its important to not only `git pull` the latest from this repo, but to also update
the `node-stratum-pool` and `node-multi-hashing` modules, and any config files that may have been changed.
* Inside your s-nomp directory (where the init.js script is) do `git pull` to get the latest s-nomp code.
* Remove the dependenices by deleting the `node_modules` directory with `rm -r node_modules`.
* Run `npm update` to force updating/reinstalling of the dependencies.
* Compare your `config.json` and `pool_configs/coin.json` configurations to the latest example ones in this repo or the ones in the setup instructions where each config field is explained. <b>You may need to modify or add any new changes.</b>


Credits
-------
### s-nomp
* [egyptianbman](https://github.com/egyptianbman)
* [nettts](https://github.com/nettts)
* [potato](https://github.com/zzzpotato)
* You belong here. Join us!

### z-nomp
* [Joshua Yabut / movrcx](https://github.com/joshuayabut)
* [Aayan L / anarch3](https://github.com/aayanl)
* [hellcatz](https://github.com/hellcatz)

### NOMP
* [Matthew Little / zone117x](https://github.com/zone117x) - developer of NOMP
* [Jerry Brady / mintyfresh68](https://github.com/bluecircle) - got coin-switching fully working and developed proxy-per-algo feature
* [Tony Dobbs](http://anthonydobbs.com) - designs for front-end and created the NOMP logo
* [LucasJones](//github.com/LucasJones) - got p2p block notify working and implemented additional hashing algos
* [vekexasia](//github.com/vekexasia) - co-developer & great tester
* [TheSeven](//github.com/TheSeven) - answering an absurd amount of my questions and being a very helpful gentleman
* [UdjinM6](//github.com/UdjinM6) - helped implement fee withdrawal in payment processing
* [Alex Petrov / sysmanalex](https://github.com/sysmanalex) - contributed the pure C block notify script
* [svirusxxx](//github.com/svirusxxx) - sponsored development of MPOS mode
* [icecube45](//github.com/icecube45) - helping out with the repo wiki
* [Fcases](//github.com/Fcases) - ordered me a pizza <3
* Those that contributed to [node-stratum-pool](//github.com/zone117x/node-stratum-pool#credits)

License
-------
Released under the MIT License. See LICENSE file.
