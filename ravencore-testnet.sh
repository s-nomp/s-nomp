#!/bin/sh

wget https://github.com/RavenProject/Ravencoin/releases/download/v4.6.1/raven-4.6.1-7864c39c2-x86_64-linux-gnu.tar.gz
tar -xf raven-4.6.1-7864c39c2-x86_64-linux-gnu.tar.gz
mv raven-4.6.1-7864c39c2 ~/raven
rm raven-4.6.1-7864c39c2*
mkdir -p ~/.raven/
touch ~/.raven/raven.conf
echo "rpcuser=user1" > ~/.raven/raven.conf
echo "rpcpassword=pass1" >> ~/.raven/raven.conf
echo "daemon=1" >> ~/.raven/raven.conf
echo "server=1" >> ~/.raven/raven.conf
echo "testnet=1" >> ~/.raven/raven.conf
