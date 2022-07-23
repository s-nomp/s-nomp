#!/bin/sh

wget https://github.com/hans-schmidt/Ravencoin/releases/download/v4.9.0test1/linux.zip
unzip linux.zip
rm linux.zip
tar -xf raven-4.9.0test1-0addc4f8b-x86_64-linux-gnu.tar.gz 
mv raven-4.9.0test1-0addc4f8b raven
rm raven-4.9.0test1-0addc4f8b*
mkdir -p ~/.raven/
touch ~/.raven/raven.conf
echo "rpcuser=user1" > ~/.raven/raven.conf
echo "rpcpassword=pass1" >> ~/.raven/raven.conf
echo "daemon=1" >> ~/.raven/raven.conf
echo "server=1" >> ~/.raven/raven.conf
echo "testnet=1" >> ~/.raven/raven.conf
