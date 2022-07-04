#!/bin/sh

wget https://github.com/hans-schmidt/Ravencoin/releases/download/v4.8.5test1/linux.zip
unzip linux.zip
rm linux.zip
tar -xf raven-4.8.5test1-01cfb1912-x86_64-linux-gnu.tar.gz 
mv raven-4.8.5test1-01cfb1912 raven
rm raven-4.8.5test1-01cfb1912*
mkdir -p ~/.raven/
touch ~/.raven/raven.conf
echo "rpcuser=user1" > ~/.raven/raven.conf
echo "rpcpassword=pass1" >> ~/.raven/raven.conf
echo "daemon=1" >> ~/.raven/raven.conf
echo "server=1" >> ~/.raven/raven.conf
echo "testnet=1" >> ~/.raven/raven.conf
