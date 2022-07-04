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

#include <sys/socket.h>
#include <netinet/in.h>
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <arpa/inet.h>

int main(int argc, char **argv) {
	int sockfd,n;
	struct sockaddr_in servaddr, cliaddr;
	char sendline[1000];
	char recvline[1000];
	char host[200];
	char *p, *arg, *errptr;
	int port;
	if (argc < 3) {
		printf("JAMPS pool block notify\n usage: <host:port> <coin> <block>\n");
		exit(1);
	}
	strncpy(host, argv[1], (sizeof(host)-1));
	p = host;
	if ( (arg = strchr(p,':')) ) {
		*arg = '\0';
		errno = 0;
		port = strtol(++arg, &errptr, 10);
		if ( (errno != 0) || (errptr == arg) ) {
			fprintf(stderr, "port number fail [%s]\n", errptr);
		}
	}
	snprintf(sendline, sizeof(sendline) - 1, "{\"command\":\"blocknotify\",\"params\":[\"%s\",\"%s\"]}\n", argv[2], argv[3]);
	sockfd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	bzero(&servaddr, sizeof(servaddr));
	servaddr.sin_family = AF_INET;
	servaddr.sin_addr.s_addr = inet_addr(host);
	servaddr.sin_port = htons(port);
	connect(sockfd, (struct sockaddr *)&servaddr, sizeof(servaddr));
	int result = send(sockfd, sendline, strlen(sendline), 0);
	close(sockfd);
	if(result == -1) {
		printf("Error sending: %i\n", errno);
		exit(-1);
	}
	exit(0);
}
