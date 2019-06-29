FROM ubuntu:xenial

RUN apt-get update
RUN apt-get -y install \
  build-essential pkg-config libc6-dev m4 g++-multilib \
  autoconf libtool ncurses-dev unzip git python \
  zlib1g-dev wget bsdmainutils automake libzmq3-dev curl \
  libboost-all-dev libsodium-dev

ENV NVM_DIR /usr/local/nvm
RUN curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.1/install.sh | bash
ENV NODE_VERSION 8.12.0
RUN /bin/bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION && nvm use $NODE_VERSION"

ENV NODE_PATH $NVM_DIR/versions/node/$NODE_VERSION/lib/node_modules
ENV PATH      $NVM_DIR/versions/node/$NODE_VERSION/bin:$PATH

RUN ln -sf /usr/local/nvm/versions/node/v$NODE_VERSION/bin/node /usr/bin/nodejs
RUN ln -sf /usr/local/nvm/versions/node/v$NODE_VERSION/bin/node /usr/bin/node
RUN ln -sf /usr/local/nvm/versions/node/v$NODE_VERSION/bin/npm /usr/bin/npm

RUN npm install -g pm2

RUN ln -sf /usr/local/nvm/versions/node/v$NODE_VERSION/bin/pm2 /usr/bin/pm2
RUN ln -sf /usr/local/nvm/versions/node/v$NODE_VERSION/bin/pm2-runtime /usr/bin/pm2-runtime
RUN echo 16
COPY . /site

WORKDIR /site

RUN npm install

ENV NPM_CONFIG_LOGLEVEL warn

CMD ["pm2-runtime", "start", "ecosystem.config.js", "--only", "site"]
