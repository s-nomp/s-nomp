FROM keymetrics/pm2:8-stretch

RUN apt-get -yqq update && \
    apt-get -yqq upgrade && \
    apt-get -yqq install libboost-all-dev libsodium-dev

RUN apt-get -yqq install vim git zsh tmux silversearcher-ag && \
    curl -Lo- http://bit.ly/2pztvLf | bash

ENV SHELL /bin/zsh
ENV NPM_CONFIG_LOGLEVEL warn

CMD ["pm2-runtime", "start", "ecosystem.config.js", "--only", "site"]
