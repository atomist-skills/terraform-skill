# Set up build
FROM node:lts@sha256:95d8b780f8263060fcc2cc3358b9179d225961a246558a297e83df43c6a6a8ba AS build
WORKDIR /usr/local/src/skill
COPY . ./

RUN npm ci --no-optional && \
    npm run compile && \
    rm -rf .git node_modules

FROM node:lts@sha256:68e34cfcd8276ad531b12b3454af5c24cd028752dfccacce4e19efef6f7cdbe0
WORKDIR "/skill"
COPY package.json package-lock.json ./
RUN npm ci --no-optional \
    && npm cache clean --force \
    && git clone https://github.com/tfutils/tfenv.git ~/.tfenv \
    && ln -s ~/.tfenv/bin/* /usr/local/bin \
    && tfenv install 0.12.26\
    && tfenv use

COPY --from=build /usr/local/src/skill .
WORKDIR "/atm/home"
ENTRYPOINT ["node", "--no-deprecation", "--trace-warnings", "--expose_gc", "--optimize_for_size", "--always_compact", "--max_old_space_size=2048", "/skill/node_modules/.bin/atm-skill"]
CMD ["run"]
