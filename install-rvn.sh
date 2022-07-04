#!/bin/sh

sudo apt update
sudo apt upgrade -y

sudo apt-get install build-essential libsodium-dev npm libboost-all-dev redis-server git

sudo npm install n -g
sudo n stable

git clone https://github.com/Seal-Clubber/s-nomp.git s-nomp
cd s-nomp

npm update
npm install
npm install sha3
npm install logger
npm install bignum

sudo npm install -g redis-commander

echo "run pool with $ node init.js"
